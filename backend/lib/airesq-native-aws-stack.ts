import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ce from 'aws-cdk-lib/aws-ce';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodeLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';

function loadLocalEnv(filePath: string): Record<string, string> {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .reduce<Record<string, string>>((values, line) => {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match) return values;

        const [, key, rawValue] = match;
        const value = rawValue.trim();
        values[key] = value.replace(/^['"]|['"]$/g, '');
        return values;
      }, {});
  } catch (error) {
    return {};
  }
}

export class AiresqNativeAwsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const projectName = 'AIResQ';
    const mobileEnv = loadLocalEnv(path.join(__dirname, '..', '..', 'mobile', '.env'));
    const environmentName = this.node.tryGetContext('environment') || 'demo';
    const alertEmail = this.node.tryGetContext('alertEmail') || process.env.AIRESQ_ALERT_EMAIL || 'demo@airesqclimsols.com';
    const monthlyBudgetUsd = Number(this.node.tryGetContext('monthlyBudgetUsd') || process.env.AIRESQ_MONTHLY_BUDGET_USD || 25);
    const anomalyThresholdUsd = Number(this.node.tryGetContext('anomalyThresholdUsd') || process.env.AIRESQ_ANOMALY_THRESHOLD_USD || 5);
    const turnstilePrivateKey = this.node.tryGetContext('turnstilePrivateKey') || process.env.TURNSTILE_PRIVATE_KEY || mobileEnv.TURNSTILE_PRIVATE_KEY || '';
    const metricPeriod = Duration.minutes(5);

    cdk.Tags.of(this).add('Project', projectName);
    cdk.Tags.of(this).add('Environment', environmentName);
    cdk.Tags.of(this).add('ManagedBy', 'AWS-CDK');

    const reportsTable = new dynamodb.Table(this, 'ReportsTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      }
    });

    reportsTable.addGlobalSecondaryIndex({
      indexName: 'status-receivedAt-index',
      partitionKey: { name: 'verification_status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'received_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    const connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl'
    });

    const photosBucket = new s3.Bucket(this, 'ReportPhotosBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'],
          allowedHeaders: ['*']
        }
      ]
    });

    const userPool = new cognito.UserPool(this, 'AdminUserPool', {
      selfSignUpEnabled: false,
      signInAliases: { username: true, email: true },
      passwordPolicy: {
        minLength: 10,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: false
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'AdminMobileClient', {
      userPool,
      authFlows: {
        userPassword: true,
        userSrp: true
      },
      preventUserExistenceErrors: true
    });

    const commonEnv = {
      REPORTS_TABLE: reportsTable.tableName,
      CONNECTIONS_TABLE: connectionsTable.tableName,
      PHOTOS_BUCKET: photosBucket.bucketName,
      TURNSTILE_PRIVATE_KEY: turnstilePrivateKey,
      CAPTCHA_SECRET: cdk.Aws.STACK_ID
    };

    const makeLambda = (name: string, handler: string, extraEnv: Record<string, string> = {}) => {
      const entry = handler.replace(/\.handler$/, '.js');
      const fn = new nodeLambda.NodejsFunction(this, name, {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '..', 'lambdas', entry),
        handler: 'handler',
        timeout: Duration.seconds(30),
        memorySize: 512,
        bundling: {
          target: 'node20',
          minify: false,
          sourceMap: true
        },
        environment: {
          ...commonEnv,
          ...extraEnv
        }
      });
      reportsTable.grantReadWriteData(fn);
      connectionsTable.grantReadWriteData(fn);
      photosBucket.grantReadWrite(fn);
      return fn;
    };

    const connectFn = makeLambda('WebSocketConnectFn', 'websocket/connect.handler');
    const disconnectFn = makeLambda('WebSocketDisconnectFn', 'websocket/disconnect.handler');

    const wsApi = new apigwv2.WebSocketApi(this, 'LiveUpdatesWebSocket', {
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('ConnectIntegration', connectFn)
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('DisconnectIntegration', disconnectFn)
      }
    });

    const wsStage = new apigwv2.WebSocketStage(this, 'LiveUpdatesStage', {
      webSocketApi: wsApi,
      stageName: 'prod',
      autoDeploy: true
    });

    const wsManagementEndpoint = `https://${wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`;

    const captchaFn = makeLambda('CaptchaFn', 'captcha/index.handler');
    const createReportFn = makeLambda('CreateReportFn', 'reports/create.handler', {
      WS_ENDPOINT: wsManagementEndpoint
    });
    const publicReportsFn = makeLambda('PublicReportsFn', 'reports/listPublic.handler');
    const adminReportsFn = makeLambda('AdminReportsFn', 'reports/listAdmin.handler');
    const updateStatusFn = makeLambda('UpdateStatusFn', 'reports/updateStatus.handler', {
      WS_ENDPOINT: wsManagementEndpoint
    });
    const deleteReportFn = makeLambda('DeleteReportFn', 'reports/delete.handler', {
      WS_ENDPOINT: wsManagementEndpoint
    });
    const appFunctions = [
      captchaFn,
      createReportFn,
      publicReportsFn,
      adminReportsFn,
      updateStatusFn,
      deleteReportFn,
      connectFn,
      disconnectFn
    ];

    createReportFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/${wsStage.stageName}/POST/@connections/*`]
    }));
    updateStatusFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/${wsStage.stageName}/POST/@connections/*`]
    }));
    deleteReportFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/${wsStage.stageName}/POST/@connections/*`]
    }));

    const httpApi = new apigwv2.HttpApi(this, 'ReportsHttpApi', {
      corsPreflight: {
        allowHeaders: ['Authorization', 'Content-Type'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS
        ],
        allowOrigins: ['*']
      }
    });

    const jwtAuthorizer = new authorizers.HttpUserPoolAuthorizer('AdminAuthorizer', userPool, {
      userPoolClients: [userPoolClient]
    });

    httpApi.addRoutes({
      path: '/captcha',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('CaptchaIntegration', captchaFn)
    });
    httpApi.addRoutes({
      path: '/reports',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('CreateReportIntegration', createReportFn)
    });
    httpApi.addRoutes({
      path: '/reports/public',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('PublicReportsIntegration', publicReportsFn)
    });
    httpApi.addRoutes({
      path: '/admin/reports',
      methods: [apigwv2.HttpMethod.GET],
      authorizer: jwtAuthorizer,
      integration: new integrations.HttpLambdaIntegration('AdminReportsIntegration', adminReportsFn)
    });
    httpApi.addRoutes({
      path: '/admin/reports/{id}/status',
      methods: [apigwv2.HttpMethod.PATCH],
      authorizer: jwtAuthorizer,
      integration: new integrations.HttpLambdaIntegration('UpdateStatusIntegration', updateStatusFn)
    });
    httpApi.addRoutes({
      path: '/admin/reports/{id}',
      methods: [apigwv2.HttpMethod.DELETE],
      authorizer: jwtAuthorizer,
      integration: new integrations.HttpLambdaIntegration('DeleteReportIntegration', deleteReportFn)
    });

    const alertTopic = new sns.Topic(this, 'MonitoringAlertsTopic', {
      displayName: `${projectName} ${environmentName} monitoring alerts`
    });
    alertTopic.addSubscription(new subscriptions.EmailSubscription(alertEmail));

    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: `${projectName}-${environmentName}-lambda-errors`,
      alarmDescription: 'One or more AIResQ Lambda functions returned errors.',
      metric: new cloudwatch.MathExpression({
        expression: 'SUM(METRICS())',
        label: 'Total Lambda errors',
        period: metricPeriod,
        usingMetrics: Object.fromEntries(
          appFunctions.map((fn, index) => [`m${index + 1}`, fn.metricErrors({ period: metricPeriod })])
        )
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    lambdaErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    const http5xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5xx',
      dimensionsMap: {
        ApiId: httpApi.apiId,
        Stage: '$default'
      },
      statistic: 'sum',
      period: metricPeriod
    });
    const http5xxAlarm = new cloudwatch.Alarm(this, 'HttpApi5xxAlarm', {
      alarmName: `${projectName}-${environmentName}-http-api-5xx`,
      alarmDescription: 'AIResQ HTTP API returned 5xx responses.',
      metric: http5xxMetric,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    http5xxAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    const dynamoThrottleMetric = (table: dynamodb.Table, metricName: string, label: string) => new cloudwatch.Metric({
      namespace: 'AWS/DynamoDB',
      metricName,
      dimensionsMap: {
        TableName: table.tableName
      },
      statistic: 'sum',
      period: metricPeriod,
      label
    });
    const reportsReadThrottleMetric = dynamoThrottleMetric(reportsTable, 'ReadThrottleEvents', 'Reports read throttles');
    const reportsWriteThrottleMetric = dynamoThrottleMetric(reportsTable, 'WriteThrottleEvents', 'Reports write throttles');
    const connectionsReadThrottleMetric = dynamoThrottleMetric(connectionsTable, 'ReadThrottleEvents', 'Connections read throttles');
    const connectionsWriteThrottleMetric = dynamoThrottleMetric(connectionsTable, 'WriteThrottleEvents', 'Connections write throttles');
    const reportsThrottleMetric = new cloudwatch.MathExpression({
      expression: 'reportsRead + reportsWrite',
      label: 'Reports table throttles',
      period: metricPeriod,
      usingMetrics: {
        reportsRead: reportsReadThrottleMetric,
        reportsWrite: reportsWriteThrottleMetric
      }
    });
    const connectionsThrottleMetric = new cloudwatch.MathExpression({
      expression: 'connectionsRead + connectionsWrite',
      label: 'Connections table throttles',
      period: metricPeriod,
      usingMetrics: {
        connectionsRead: connectionsReadThrottleMetric,
        connectionsWrite: connectionsWriteThrottleMetric
      }
    });
    const totalDynamoThrottleMetric = new cloudwatch.MathExpression({
      expression: 'reportsRead + reportsWrite + connectionsRead + connectionsWrite',
      label: 'DynamoDB throttled events',
      period: metricPeriod,
      usingMetrics: {
        reportsRead: reportsReadThrottleMetric,
        reportsWrite: reportsWriteThrottleMetric,
        connectionsRead: connectionsReadThrottleMetric,
        connectionsWrite: connectionsWriteThrottleMetric
      }
    });
    const dynamoThrottleAlarm = new cloudwatch.Alarm(this, 'DynamoThrottleAlarm', {
      alarmName: `${projectName}-${environmentName}-dynamodb-throttles`,
      alarmDescription: 'AIResQ DynamoDB tables reported throttled requests.',
      metric: totalDynamoThrottleMetric,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    dynamoThrottleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    const monitoredCostServices = [
      'AWS Lambda',
      'Amazon API Gateway',
      'Amazon DynamoDB',
      'Amazon Simple Storage Service',
      'Amazon Cognito',
      'AmazonCloudWatch'
    ];
    const budgetSubscriber = {
      address: alertEmail,
      subscriptionType: 'EMAIL'
    };
    new budgets.CfnBudget(this, 'ProjectMonthlyBudget', {
      budget: {
        budgetName: `${projectName}-${environmentName}-serverless-services-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: monthlyBudgetUsd,
          unit: 'USD'
        },
        filterExpression: {
          and: [
            {
              tags: {
                key: 'Project',
                values: [projectName],
                matchOptions: ['EQUALS']
              }
            },
            {
              dimensions: {
                key: 'SERVICE',
                values: monitoredCostServices,
                matchOptions: ['EQUALS']
              }
            }
          ]
        }
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'ACTUAL',
            threshold: 80,
            thresholdType: 'PERCENTAGE'
          },
          subscribers: [budgetSubscriber]
        },
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'FORECASTED',
            threshold: 100,
            thresholdType: 'PERCENTAGE'
          },
          subscribers: [budgetSubscriber]
        }
      ],
      resourceTags: [
        { key: 'Project', value: projectName },
        { key: 'Environment', value: environmentName }
      ]
    });

    const costAnomalyMonitor = new ce.CfnAnomalyMonitor(this, 'ServiceCostAnomalyMonitor', {
      monitorName: `${projectName}-${environmentName}-service-costs`,
      monitorType: 'CUSTOM',
      monitorSpecification: JSON.stringify({
        Tags: {
          Key: 'Project',
          Values: [projectName]
        }
      }),
      resourceTags: [
        { key: 'Project', value: projectName },
        { key: 'Environment', value: environmentName }
      ]
    });
    new ce.CfnAnomalySubscription(this, 'ServiceCostAnomalySubscription', {
      subscriptionName: `${projectName}-${environmentName}-cost-anomalies`,
      frequency: 'DAILY',
      monitorArnList: [costAnomalyMonitor.attrMonitorArn],
      thresholdExpression: JSON.stringify({
        Dimensions: {
          Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
          MatchOptions: ['GREATER_THAN_OR_EQUAL'],
          Values: [String(anomalyThresholdUsd)]
        }
      }),
      subscribers: [
        {
          address: alertEmail,
          type: 'EMAIL'
        }
      ],
      resourceTags: [
        { key: 'Project', value: projectName },
        { key: 'Environment', value: environmentName }
      ]
    });

    const httpDimensions = {
      ApiId: httpApi.apiId,
      Stage: '$default'
    };
    const wsDimensions = {
      ApiId: wsApi.apiId,
      Stage: wsStage.stageName
    };
    const dashboard = new cloudwatch.Dashboard(this, 'OperationsDashboard', {
      dashboardName: `${projectName}-${environmentName}-serverless-usage`
    });
    dashboard.addWidgets(new cloudwatch.TextWidget({
      markdown: [
        `# ${projectName} ${environmentName} monitoring`,
        '',
        `Budget alert email: ${alertEmail}`,
        `Monthly services budget: $${monthlyBudgetUsd}`,
        `Cost anomaly threshold: $${anomalyThresholdUsd}`,
        '',
        'Cost data appears in AWS Cost Explorer/Budgets after billing processing. Use Cost Explorer grouped by Service or by the activated Project/Environment cost allocation tags for service-level spend.'
      ].join('\n'),
      width: 24,
      height: 5
    }));
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'HTTP API usage and errors',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Count',
            dimensionsMap: httpDimensions,
            statistic: 'sum',
            period: metricPeriod,
            label: 'HTTP requests'
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '4xx',
            dimensionsMap: httpDimensions,
            statistic: 'sum',
            period: metricPeriod,
            label: 'HTTP 4xx'
          }),
          http5xxMetric.with({ label: 'HTTP 5xx' })
        ]
      }),
      new cloudwatch.GraphWidget({
        title: 'HTTP API latency',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Latency',
            dimensionsMap: httpDimensions,
            statistic: 'avg',
            period: metricPeriod,
            label: 'Average latency'
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'IntegrationLatency',
            dimensionsMap: httpDimensions,
            statistic: 'avg',
            period: metricPeriod,
            label: 'Integration latency'
          })
        ]
      })
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda invocations',
        width: 12,
        left: appFunctions.map((fn) => fn.metricInvocations({ period: metricPeriod, statistic: 'sum' }))
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda errors and duration',
        width: 12,
        left: appFunctions.map((fn) => fn.metricErrors({ period: metricPeriod, statistic: 'sum' })),
        right: appFunctions.map((fn) => fn.metricDuration({ period: metricPeriod, statistic: 'avg' }))
      })
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'DynamoDB read/write usage',
        width: 12,
        left: [
          reportsTable.metricConsumedReadCapacityUnits({ period: metricPeriod, statistic: 'sum', label: 'Reports reads' }),
          reportsTable.metricConsumedWriteCapacityUnits({ period: metricPeriod, statistic: 'sum', label: 'Reports writes' }),
          connectionsTable.metricConsumedReadCapacityUnits({ period: metricPeriod, statistic: 'sum', label: 'Connections reads' }),
          connectionsTable.metricConsumedWriteCapacityUnits({ period: metricPeriod, statistic: 'sum', label: 'Connections writes' })
        ]
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB throttles',
        width: 12,
        left: [
          reportsThrottleMetric,
          connectionsThrottleMetric
        ]
      })
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'S3 photo storage',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: 'BucketSizeBytes',
            dimensionsMap: {
              BucketName: photosBucket.bucketName,
              StorageType: 'StandardStorage'
            },
            statistic: 'average',
            period: Duration.days(1),
            label: 'Photo storage bytes'
          })
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: 'NumberOfObjects',
            dimensionsMap: {
              BucketName: photosBucket.bucketName,
              StorageType: 'AllStorageTypes'
            },
            statistic: 'average',
            period: Duration.days(1),
            label: 'Photo object count'
          })
        ]
      }),
      new cloudwatch.GraphWidget({
        title: 'WebSocket live-map usage',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'ConnectCount',
            dimensionsMap: wsDimensions,
            statistic: 'sum',
            period: metricPeriod,
            label: 'Connects'
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'MessageCount',
            dimensionsMap: wsDimensions,
            statistic: 'sum',
            period: metricPeriod,
            label: 'Messages'
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'ClientError',
            dimensionsMap: wsDimensions,
            statistic: 'sum',
            period: metricPeriod,
            label: 'Client errors'
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'ExecutionError',
            dimensionsMap: wsDimensions,
            statistic: 'sum',
            period: metricPeriod,
            label: 'Execution errors'
          })
        ]
      })
    );

    new cdk.CfnOutput(this, 'ApiBaseUrl', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'WebSocketUrl', { value: wsStage.url });
    new cdk.CfnOutput(this, 'CognitoUserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'CognitoUserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'ReportsTableName', { value: reportsTable.tableName });
    new cdk.CfnOutput(this, 'PhotosBucketName', { value: photosBucket.bucketName });
    new cdk.CfnOutput(this, 'MonitoringDashboardName', { value: dashboard.dashboardName });
    new cdk.CfnOutput(this, 'MonitoringDashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`
    });
    new cdk.CfnOutput(this, 'MonitoringAlertEmail', { value: alertEmail });
    new cdk.CfnOutput(this, 'MonthlyBudgetUsd', { value: String(monthlyBudgetUsd) });
  }
}
