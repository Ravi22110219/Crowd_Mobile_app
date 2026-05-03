"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiresqNativeAwsStack = void 0;
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const apigwv2 = require("aws-cdk-lib/aws-apigatewayv2");
const authorizers = require("aws-cdk-lib/aws-apigatewayv2-authorizers");
const integrations = require("aws-cdk-lib/aws-apigatewayv2-integrations");
const budgets = require("aws-cdk-lib/aws-budgets");
const cloudwatch = require("aws-cdk-lib/aws-cloudwatch");
const cloudwatchActions = require("aws-cdk-lib/aws-cloudwatch-actions");
const ce = require("aws-cdk-lib/aws-ce");
const cognito = require("aws-cdk-lib/aws-cognito");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const iam = require("aws-cdk-lib/aws-iam");
const lambda = require("aws-cdk-lib/aws-lambda");
const nodeLambda = require("aws-cdk-lib/aws-lambda-nodejs");
const s3 = require("aws-cdk-lib/aws-s3");
const sns = require("aws-cdk-lib/aws-sns");
const subscriptions = require("aws-cdk-lib/aws-sns-subscriptions");
const fs = require("fs");
const path = require("path");
function loadLocalEnv(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .reduce((values, line) => {
            const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
            if (!match)
                return values;
            const [, key, rawValue] = match;
            const value = rawValue.trim();
            values[key] = value.replace(/^['"]|['"]$/g, '');
            return values;
        }, {});
    }
    catch (error) {
        return {};
    }
}
class AiresqNativeAwsStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const projectName = 'AIResQ';
        const mobileEnv = loadLocalEnv(path.join(__dirname, '..', '..', 'mobile', '.env'));
        const environmentName = this.node.tryGetContext('environment') || 'demo';
        const alertEmail = this.node.tryGetContext('alertEmail') || process.env.AIRESQ_ALERT_EMAIL || 'demo@airesqclimsols.com';
        const monthlyBudgetUsd = Number(this.node.tryGetContext('monthlyBudgetUsd') || process.env.AIRESQ_MONTHLY_BUDGET_USD || 25);
        const anomalyThresholdUsd = Number(this.node.tryGetContext('anomalyThresholdUsd') || process.env.AIRESQ_ANOMALY_THRESHOLD_USD || 5);
        const turnstilePrivateKey = this.node.tryGetContext('turnstilePrivateKey') || process.env.TURNSTILE_PRIVATE_KEY || mobileEnv.TURNSTILE_PRIVATE_KEY || '';
        const metricPeriod = aws_cdk_lib_1.Duration.minutes(5);
        cdk.Tags.of(this).add('Project', projectName);
        cdk.Tags.of(this).add('Environment', environmentName);
        cdk.Tags.of(this).add('ManagedBy', 'AWS-CDK');
        const reportsTable = new dynamodb.Table(this, 'ReportsTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.RETAIN,
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
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ttl'
        });
        const photosBucket = new s3.Bucket(this, 'ReportPhotosBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.RETAIN,
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
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.RETAIN
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
        const makeLambda = (name, handler, extraEnv = {}) => {
            const entry = handler.replace(/\.handler$/, '.js');
            const fn = new nodeLambda.NodejsFunction(this, name, {
                runtime: lambda.Runtime.NODEJS_20_X,
                entry: path.join(__dirname, '..', 'lambdas', entry),
                handler: 'handler',
                timeout: aws_cdk_lib_1.Duration.seconds(30),
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
                usingMetrics: Object.fromEntries(appFunctions.map((fn, index) => [`m${index + 1}`, fn.metricErrors({ period: metricPeriod })]))
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
        const dynamoThrottleMetric = (table, metricName, label) => new cloudwatch.Metric({
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
        dashboard.addWidgets(new cloudwatch.GraphWidget({
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
        }), new cloudwatch.GraphWidget({
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
        }));
        dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Lambda invocations',
            width: 12,
            left: appFunctions.map((fn) => fn.metricInvocations({ period: metricPeriod, statistic: 'sum' }))
        }), new cloudwatch.GraphWidget({
            title: 'Lambda errors and duration',
            width: 12,
            left: appFunctions.map((fn) => fn.metricErrors({ period: metricPeriod, statistic: 'sum' })),
            right: appFunctions.map((fn) => fn.metricDuration({ period: metricPeriod, statistic: 'avg' }))
        }));
        dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'DynamoDB read/write usage',
            width: 12,
            left: [
                reportsTable.metricConsumedReadCapacityUnits({ period: metricPeriod, statistic: 'sum', label: 'Reports reads' }),
                reportsTable.metricConsumedWriteCapacityUnits({ period: metricPeriod, statistic: 'sum', label: 'Reports writes' }),
                connectionsTable.metricConsumedReadCapacityUnits({ period: metricPeriod, statistic: 'sum', label: 'Connections reads' }),
                connectionsTable.metricConsumedWriteCapacityUnits({ period: metricPeriod, statistic: 'sum', label: 'Connections writes' })
            ]
        }), new cloudwatch.GraphWidget({
            title: 'DynamoDB throttles',
            width: 12,
            left: [
                reportsThrottleMetric,
                connectionsThrottleMetric
            ]
        }));
        dashboard.addWidgets(new cloudwatch.GraphWidget({
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
                    period: aws_cdk_lib_1.Duration.days(1),
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
                    period: aws_cdk_lib_1.Duration.days(1),
                    label: 'Photo object count'
                })
            ]
        }), new cloudwatch.GraphWidget({
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
        }));
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
exports.AiresqNativeAwsStack = AiresqNativeAwsStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWlyZXNxLW5hdGl2ZS1hd3Mtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhaXJlc3EtbmF0aXZlLWF3cy1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsNkNBQXlFO0FBQ3pFLHdEQUF3RDtBQUN4RCx3RUFBd0U7QUFDeEUsMEVBQTBFO0FBQzFFLG1EQUFtRDtBQUNuRCx5REFBeUQ7QUFDekQsd0VBQXdFO0FBQ3hFLHlDQUF5QztBQUN6QyxtREFBbUQ7QUFDbkQscURBQXFEO0FBQ3JELDJDQUEyQztBQUMzQyxpREFBaUQ7QUFDakQsNERBQTREO0FBQzVELHlDQUF5QztBQUN6QywyQ0FBMkM7QUFDM0MsbUVBQW1FO0FBRW5FLHlCQUF5QjtBQUN6Qiw2QkFBNkI7QUFFN0IsU0FBUyxZQUFZLENBQUMsUUFBZ0I7SUFDcEMsSUFBSSxDQUFDO1FBQ0gsT0FBTyxFQUFFLENBQUMsWUFBWSxDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUM7YUFDckMsS0FBSyxDQUFDLE9BQU8sQ0FBQzthQUNkLE1BQU0sQ0FBeUIsQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLEVBQUU7WUFDL0MsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyw2Q0FBNkMsQ0FBQyxDQUFDO1lBQ3hFLElBQUksQ0FBQyxLQUFLO2dCQUFFLE9BQU8sTUFBTSxDQUFDO1lBRTFCLE1BQU0sQ0FBQyxFQUFFLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxLQUFLLENBQUM7WUFDaEMsTUFBTSxLQUFLLEdBQUcsUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQzlCLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLGNBQWMsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUNoRCxPQUFPLE1BQU0sQ0FBQztRQUNoQixDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDWCxDQUFDO0lBQUMsT0FBTyxLQUFLLEVB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J2F3cy1jZGstbGliJztcbmltcG9ydCB7IER1cmF0aW9uLCBSZW1vdmFsUG9saWN5LCBTdGFjaywgU3RhY2tQcm9wcyB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGFwaWd3djIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXl2Mic7XG5pbXBvcnQgKiBhcyBhdXRob3JpemVycyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyLWF1dGhvcml6ZXJzJztcbmltcG9ydCAqIGFzIGludGVncmF0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyLWludGVncmF0aW9ucyc7XG5pbXBvcnQgKiBhcyBidWRnZXRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1idWRnZXRzJztcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2ggZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaEFjdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gtYWN0aW9ucyc7XG5pbXBvcnQgKiBhcyBjZSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2UnO1xuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgbm9kZUxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0ICogYXMgc3Vic2NyaXB0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zLXN1YnNjcmlwdGlvbnMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuXG5mdW5jdGlvbiBsb2FkTG9jYWxFbnYoZmlsZVBhdGg6IHN0cmluZyk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICB0cnkge1xuICAgIHJldHVybiBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4JylcbiAgICAgIC5zcGxpdCgvXFxyP1xcbi8pXG4gICAgICAucmVkdWNlPFJlY29yZDxzdHJpbmcsIHN0cmluZz4+KCh2YWx1ZXMsIGxpbmUpID0+IHtcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eXFxzKihbQS1aYS16X11bQS1aYS16MC05X10qKVxccyo9XFxzKiguKilcXHMqJC8pO1xuICAgICAgICBpZiAoIW1hdGNoKSByZXR1cm4gdmFsdWVzO1xuXG4gICAgICAgIGNvbnN0IFssIGtleSwgcmF3VmFsdWVdID0gbWF0Y2g7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gcmF3VmFsdWUudHJpbSgpO1xuICAgICAgICB2YWx1ZXNba2V5XSA9IHZhbHVlLnJlcGxhY2UoL15bJ1wiXXxbJ1wiXSQvZywgJycpO1xuICAgICAgICByZXR1cm4gdmFsdWVzO1xuICAgICAgfSwge30pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiB7fTtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgQWlyZXNxTmF0aXZlQXdzU3RhY2sgZXh0ZW5kcyBTdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgcHJvamVjdE5hbWUgPSAnQUlSZXNRJztcbiAgICBjb25zdCBtb2JpbGVFbnYgPSBsb2FkTG9jYWxFbnYocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJ21vYmlsZScsICcuZW52JykpO1xuICAgIGNvbnN0IGVudmlyb25tZW50TmFtZSA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdlbnZpcm9ubWVudCcpIHx8ICdkZW1vJztcbiAgICBjb25zdCBhbGVydEVtYWlsID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2FsZXJ0RW1haWwnKSB8fCBwcm9jZXNzLmVudi5BSVJFU1FfQUxFUlRfRU1BSUwgfHwgJ2RlbW9AYWlyZXNxY2xpbXNvbHMuY29tJztcbiAgICBjb25zdCBtb250aGx5QnVkZ2V0VXNkID0gTnVtYmVyKHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdtb250aGx5QnVkZ2V0VXNkJykgfHwgcHJvY2Vzcy5lbnYuQUlSRVNRX01PTlRITFlfQlVER0VUX1VTRCB8fCAyNSk7XG4gICAgY29uc3QgYW5vbWFseVRocmVzaG9sZFVzZCA9IE51bWJlcih0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnYW5vbWFseVRocmVzaG9sZFVzZCcpIHx8IHByb2Nlc3MuZW52LkFJUkVTUV9BTk9NQUxZX1RIUkVTSE9MRF9VU0QgfHwgNSk7XG4gICAgY29uc3QgdHVybnN0aWxlUHJpdmF0ZUtleSA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCd0dXJuc3RpbGVQcml2YXRlS2V5JykgfHwgcHJvY2Vzcy5lbnYuVFVSTlNUSUxFX1BSSVZBVEVfS0VZIHx8IG1vYmlsZUVudi5UVVJOU1RJTEVfUFJJVkFURV9LRVkgfHwgJyc7XG4gICAgY29uc3QgbWV0cmljUGVyaW9kID0gRHVyYXRpb24ubWludXRlcyg1KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnUHJvamVjdCcsIHByb2plY3ROYW1lKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ01hbmFnZWRCeScsICdBV1MtQ0RLJyk7XG5cbiAgICBjb25zdCByZXBvcnRzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1JlcG9ydHNUYWJsZScsIHtcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeVNwZWNpZmljYXRpb246IHtcbiAgICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeUVuYWJsZWQ6IHRydWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJlcG9ydHNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdzdGF0dXMtcmVjZWl2ZWRBdC1pbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3ZlcmlmaWNhdGlvbl9zdGF0dXMnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiAncmVjZWl2ZWRfYXQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29ubmVjdGlvbnNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQ29ubmVjdGlvbnNUYWJsZScsIHtcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnY29ubmVjdGlvbklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJ1xuICAgIH0pO1xuXG4gICAgY29uc3QgcGhvdG9zQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnUmVwb3J0UGhvdG9zQnVja2V0Jywge1xuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgIGNvcnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBbczMuSHR0cE1ldGhvZHMuR0VULCBzMy5IdHRwTWV0aG9kcy5QVVQsIHMzLkh0dHBNZXRob2RzLlBPU1RdLFxuICAgICAgICAgIGFsbG93ZWRPcmlnaW5zOiBbJyonXSxcbiAgICAgICAgICBhbGxvd2VkSGVhZGVyczogWycqJ11cbiAgICAgICAgfVxuICAgICAgXVxuICAgIH0pO1xuXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnQWRtaW5Vc2VyUG9vbCcsIHtcbiAgICAgIHNlbGZTaWduVXBFbmFibGVkOiBmYWxzZSxcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHsgdXNlcm5hbWU6IHRydWUsIGVtYWlsOiB0cnVlIH0sXG4gICAgICBwYXNzd29yZFBvbGljeToge1xuICAgICAgICBtaW5MZW5ndGg6IDEwLFxuICAgICAgICByZXF1aXJlRGlnaXRzOiB0cnVlLFxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlU3ltYm9sczogZmFsc2VcbiAgICAgIH0sXG4gICAgICBhY2NvdW50UmVjb3Zlcnk6IGNvZ25pdG8uQWNjb3VudFJlY292ZXJ5LkVNQUlMX09OTFksXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LlJFVEFJTlxuICAgIH0pO1xuXG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCAnQWRtaW5Nb2JpbGVDbGllbnQnLCB7XG4gICAgICB1c2VyUG9vbCxcbiAgICAgIGF1dGhGbG93czoge1xuICAgICAgICB1c2VyUGFzc3dvcmQ6IHRydWUsXG4gICAgICAgIHVzZXJTcnA6IHRydWVcbiAgICAgIH0sXG4gICAgICBwcmV2ZW50VXNlckV4aXN0ZW5jZUVycm9yczogdHJ1ZVxuICAgIH0pO1xuXG4gICAgY29uc3QgY29tbW9uRW52ID0ge1xuICAgICAgUkVQT1JUU19UQUJMRTogcmVwb3J0c1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgIENPTk5FQ1RJT05TX1RBQkxFOiBjb25uZWN0aW9uc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgIFBIT1RPU19CVUNLRVQ6IHBob3Rvc0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgVFVSTlNUSUxFX1BSSVZBVEVfS0VZOiB0dXJuc3RpbGVQcml2YXRlS2V5LFxuICAgICAgQ0FQVENIQV9TRUNSRVQ6IGNkay5Bd3MuU1RBQ0tfSURcbiAgICB9O1xuXG4gICAgY29uc3QgbWFrZUxhbWJkYSA9IChuYW1lOiBzdHJpbmcsIGhhbmRsZXI6IHN0cmluZywgZXh0cmFFbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fSkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSBoYW5kbGVyLnJlcGxhY2UoL1xcLmhhbmRsZXIkLywgJy5qcycpO1xuICAgICAgY29uc3QgZm4gPSBuZXcgbm9kZUxhbWJkYS5Ob2RlanNGdW5jdGlvbih0aGlzLCBuYW1lLCB7XG4gICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJ2xhbWJkYXMnLCBlbnRyeSksXG4gICAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICB0YXJnZXQ6ICdub2RlMjAnLFxuICAgICAgICAgIG1pbmlmeTogZmFsc2UsXG4gICAgICAgICAgc291cmNlTWFwOiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgLi4uY29tbW9uRW52LFxuICAgICAgICAgIC4uLmV4dHJhRW52XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgcmVwb3J0c1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShmbik7XG4gICAgICBjb25uZWN0aW9uc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShmbik7XG4gICAgICBwaG90b3NCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoZm4pO1xuICAgICAgcmV0dXJuIGZuO1xuICAgIH07XG5cbiAgICBjb25zdCBjb25uZWN0Rm4gPSBtYWtlTGFtYmRhKCdXZWJTb2NrZXRDb25uZWN0Rm4nLCAnd2Vic29ja2V0L2Nvbm5lY3QuaGFuZGxlcicpO1xuICAgIGNvbnN0IGRpc2Nvbm5lY3RGbiA9IG1ha2VMYW1iZGEoJ1dlYlNvY2tldERpc2Nvbm5lY3RGbicsICd3ZWJzb2NrZXQvZGlzY29ubmVjdC5oYW5kbGVyJyk7XG5cbiAgICBjb25zdCB3c0FwaSA9IG5ldyBhcGlnd3YyLldlYlNvY2tldEFwaSh0aGlzLCAnTGl2ZVVwZGF0ZXNXZWJTb2NrZXQnLCB7XG4gICAgICBjb25uZWN0Um91dGVPcHRpb25zOiB7XG4gICAgICAgIGludGVncmF0aW9uOiBuZXcgaW50ZWdyYXRpb25zLldlYlNvY2tldExhbWJkYUludGVncmF0aW9uKCdDb25uZWN0SW50ZWdyYXRpb24nLCBjb25uZWN0Rm4pXG4gICAgICB9LFxuICAgICAgZGlzY29ubmVjdFJvdXRlT3B0aW9uczoge1xuICAgICAgICBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5XZWJTb2NrZXRMYW1iZGFJbnRlZ3JhdGlvbignRGlzY29ubmVjdEludGVncmF0aW9uJywgZGlzY29ubmVjdEZuKVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3Qgd3NTdGFnZSA9IG5ldyBhcGlnd3YyLldlYlNvY2tldFN0YWdlKHRoaXMsICdMaXZlVXBkYXRlc1N0YWdlJywge1xuICAgICAgd2ViU29ja2V0QXBpOiB3c0FwaSxcbiAgICAgIHN0YWdlTmFtZTogJ3Byb2QnLFxuICAgICAgYXV0b0RlcGxveTogdHJ1ZVxuICAgIH0pO1xuXG4gICAgY29uc3Qgd3NNYW5hZ2VtZW50RW5kcG9pbnQgPSBgaHR0cHM6Ly8ke3dzQXBpLmFwaUlkfS5leGVjdXRlLWFwaS4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tLyR7d3NTdGFnZS5zdGFnZU5hbWV9YDtcblxuICAgIGNvbnN0IGNhcHRjaGFGbiA9IG1ha2VMYW1iZGEoJ0NhcHRjaGFGbicsICdjYXB0Y2hhL2luZGV4LmhhbmRsZXInKTtcbiAgICBjb25zdCBjcmVhdGVSZXBvcnRGbiA9IG1ha2VMYW1iZGEoJ0NyZWF0ZVJlcG9ydEZuJywgJ3JlcG9ydHMvY3JlYXRlLmhhbmRsZXInLCB7XG4gICAgICBXU19FTkRQT0lOVDogd3NNYW5hZ2VtZW50RW5kcG9pbnRcbiAgICB9KTtcbiAgICBjb25zdCBwdWJsaWNSZXBvcnRzRm4gPSBtYWtlTGFtYmRhKCdQdWJsaWNSZXBvcnRzRm4nLCAncmVwb3J0cy9saXN0UHVibGljLmhhbmRsZXInKTtcbiAgICBjb25zdCBhZG1pblJlcG9ydHNGbiA9IG1ha2VMYW1iZGEoJ0FkbWluUmVwb3J0c0ZuJywgJ3JlcG9ydHMvbGlzdEFkbWluLmhhbmRsZXInKTtcbiAgICBjb25zdCB1cGRhdGVTdGF0dXNGbiA9IG1ha2VMYW1iZGEoJ1VwZGF0ZVN0YXR1c0ZuJywgJ3JlcG9ydHMvdXBkYXRlU3RhdHVzLmhhbmRsZXInLCB7XG4gICAgICBXU19FTkRQT0lOVDogd3NNYW5hZ2VtZW50RW5kcG9pbnRcbiAgICB9KTtcbiAgICBjb25zdCBkZWxldGVSZXBvcnRGbiA9IG1ha2VMYW1iZGEoJ0RlbGV0ZVJlcG9ydEZuJywgJ3JlcG9ydHMvZGVsZXRlLmhhbmRsZXInLCB7XG4gICAgICBXU19FTkRQT0lOVDogd3NNYW5hZ2VtZW50RW5kcG9pbnRcbiAgICB9KTtcbiAgICBjb25zdCBhcHBGdW5jdGlvbnMgPSBbXG4gICAgICBjYXB0Y2hhRm4sXG4gICAgICBjcmVhdGVSZXBvcnRGbixcbiAgICAgIHB1YmxpY1JlcG9ydHNGbixcbiAgICAgIGFkbWluUmVwb3J0c0ZuLFxuICAgICAgdXBkYXRlU3RhdHVzRm4sXG4gICAgICBkZWxldGVSZXBvcnRGbixcbiAgICAgIGNvbm5lY3RGbixcbiAgICAgIGRpc2Nvbm5lY3RGblxuICAgIF07XG5cbiAgICBjcmVhdGVSZXBvcnRGbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydleGVjdXRlLWFwaTpNYW5hZ2VDb25uZWN0aW9ucyddLFxuICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6ZXhlY3V0ZS1hcGk6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OiR7d3NBcGkuYXBpSWR9LyR7d3NTdGFnZS5zdGFnZU5hbWV9L1BPU1QvQGNvbm5lY3Rpb25zLypgXVxuICAgIH0pKTtcbiAgICB1cGRhdGVTdGF0dXNGbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydleGVjdXRlLWFwaTpNYW5hZ2VDb25uZWN0aW9ucyddLFxuICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6ZXhlY3V0ZS1hcGk6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OiR7d3NBcGkuYXBpSWR9LyR7d3NTdGFnZS5zdGFnZU5hbWV9L1BPU1QvQGNvbm5lY3Rpb25zLypgXVxuICAgIH0pKTtcbiAgICBkZWxldGVSZXBvcnRGbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydleGVjdXRlLWFwaTpNYW5hZ2VDb25uZWN0aW9ucyddLFxuICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6ZXhlY3V0ZS1hcGk6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OiR7d3NBcGkuYXBpSWR9LyR7d3NTdGFnZS5zdGFnZU5hbWV9L1BPU1QvQGNvbm5lY3Rpb25zLypgXVxuICAgIH0pKTtcblxuICAgIGNvbnN0IGh0dHBBcGkgPSBuZXcgYXBpZ3d2Mi5IdHRwQXBpKHRoaXMsICdSZXBvcnRzSHR0cEFwaScsIHtcbiAgICAgIGNvcnNQcmVmbGlnaHQ6IHtcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBbJ0F1dGhvcml6YXRpb24nLCAnQ29udGVudC1UeXBlJ10sXG4gICAgICAgIGFsbG93TWV0aG9kczogW1xuICAgICAgICAgIGFwaWd3djIuQ29yc0h0dHBNZXRob2QuR0VULFxuICAgICAgICAgIGFwaWd3djIuQ29yc0h0dHBNZXRob2QuUE9TVCxcbiAgICAgICAgICBhcGlnd3YyLkNvcnNIdHRwTWV0aG9kLlBBVENILFxuICAgICAgICAgIGFwaWd3djIuQ29yc0h0dHBNZXRob2QuREVMRVRFLFxuICAgICAgICAgIGFwaWd3djIuQ29yc0h0dHBNZXRob2QuT1BUSU9OU1xuICAgICAgICBdLFxuICAgICAgICBhbGxvd09yaWdpbnM6IFsnKiddXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBqd3RBdXRob3JpemVyID0gbmV3IGF1dGhvcml6ZXJzLkh0dHBVc2VyUG9vbEF1dGhvcml6ZXIoJ0FkbWluQXV0aG9yaXplcicsIHVzZXJQb29sLCB7XG4gICAgICB1c2VyUG9vbENsaWVudHM6IFt1c2VyUG9vbENsaWVudF1cbiAgICB9KTtcblxuICAgIGh0dHBBcGkuYWRkUm91dGVzKHtcbiAgICAgIHBhdGg6ICcvY2FwdGNoYScsXG4gICAgICBtZXRob2RzOiBbYXBpZ3d2Mi5IdHRwTWV0aG9kLkdFVF0sXG4gICAgICBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5IdHRwTGFtYmRhSW50ZWdyYXRpb24oJ0NhcHRjaGFJbnRlZ3JhdGlvbicsIGNhcHRjaGFGbilcbiAgICB9KTtcbiAgICBodHRwQXBpLmFkZFJvdXRlcyh7XG4gICAgICBwYXRoOiAnL3JlcG9ydHMnLFxuICAgICAgbWV0aG9kczogW2FwaWd3djIuSHR0cE1ldGhvZC5QT1NUXSxcbiAgICAgIGludGVncmF0aW9uOiBuZXcgaW50ZWdyYXRpb25zLkh0dHBMYW1iZGFJbnRlZ3JhdGlvbignQ3JlYXRlUmVwb3J0SW50ZWdyYXRpb24nLCBjcmVhdGVSZXBvcnRGbilcbiAgICB9KTtcbiAgICBodHRwQXBpLmFkZFJvdXRlcyh7XG4gICAgICBwYXRoOiAnL3JlcG9ydHMvcHVibGljJyxcbiAgICAgIG1ldGhvZHM6IFthcGlnd3YyLkh0dHBNZXRob2QuR0VUXSxcbiAgICAgIGludGVncmF0aW9uOiBuZXcgaW50ZWdyYXRpb25zLkh0dHBMYW1iZGFJbnRlZ3JhdGlvbignUHVibGljUmVwb3J0c0ludGVncmF0aW9uJywgcHVibGljUmVwb3J0c0ZuKVxuICAgIH0pO1xuICAgIGh0dHBBcGkuYWRkUm91dGVzKHtcbiAgICAgIHBhdGg6ICcvYWRtaW4vcmVwb3J0cycsXG4gICAgICBtZXRob2RzOiBbYXBpZ3d2Mi5IdHRwTWV0aG9kLkdFVF0sXG4gICAgICBhdXRob3JpemVyOiBqd3RBdXRob3JpemVyLFxuICAgICAgaW50ZWdyYXRpb246IG5ldyBpbnRlZ3JhdGlvbnMuSHR0cExhbWJkYUludGVncmF0aW9uKCdBZG1pblJlcG9ydHNJbnRlZ3JhdGlvbicsIGFkbWluUmVwb3J0c0ZuKVxuICAgIH0pO1xuICAgIGh0dHBBcGkuYWRkUm91dGVzKHtcbiAgICAgIHBhdGg6ICcvYWRtaW4vcmVwb3J0cy97aWR9L3N0YXR1cycsXG4gICAgICBtZXRob2RzOiBbYXBpZ3d2Mi5IdHRwTWV0aG9kLlBBVENIXSxcbiAgICAgIGF1dGhvcml6ZXI6IGp3dEF1dGhvcml6ZXIsXG4gICAgICBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5IdHRwTGFtYmRhSW50ZWdyYXRpb24oJ1VwZGF0ZVN0YXR1c0ludGVncmF0aW9uJywgdXBkYXRlU3RhdHVzRm4pXG4gICAgfSk7XG4gICAgaHR0cEFwaS5hZGRSb3V0ZXMoe1xuICAgICAgcGF0aDogJy9hZG1pbi9yZXBvcnRzL3tpZH0nLFxuICAgICAgbWV0aG9kczogW2FwaWd3djIuSHR0cE1ldGhvZC5ERUxFVEVdLFxuICAgICAgYXV0aG9yaXplcjogand0QXV0aG9yaXplcixcbiAgICAgIGludGVncmF0aW9uOiBuZXcgaW50ZWdyYXRpb25zLkh0dHBMYW1iZGFJbnRlZ3JhdGlvbignRGVsZXRlUmVwb3J0SW50ZWdyYXRpb24nLCBkZWxldGVSZXBvcnRGbilcbiAgICB9KTtcblxuICAgIGNvbnN0IGFsZXJ0VG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdNb25pdG9yaW5nQWxlcnRzVG9waWMnLCB7XG4gICAgICBkaXNwbGF5TmFtZTogYCR7cHJvamVjdE5hbWV9ICR7ZW52aXJvbm1lbnROYW1lfSBtb25pdG9yaW5nIGFsZXJ0c2BcbiAgICB9KTtcbiAgICBhbGVydFRvcGljLmFkZFN1YnNjcmlwdGlvbihuZXcgc3Vic2NyaXB0aW9ucy5FbWFpbFN1YnNjcmlwdGlvbihhbGVydEVtYWlsKSk7XG5cbiAgICBjb25zdCBsYW1iZGFFcnJvckFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0xhbWJkYUVycm9yQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6IGAke3Byb2plY3ROYW1lfS0ke2Vudmlyb25tZW50TmFtZX0tbGFtYmRhLWVycm9yc2AsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnT25lIG9yIG1vcmUgQUlSZXNRIExhbWJkYSBmdW5jdGlvbnMgcmV0dXJuZWQgZXJyb3JzLicsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1hdGhFeHByZXNzaW9uKHtcbiAgICAgICAgZXhwcmVzc2lvbjogJ1NVTShNRVRSSUNTKCkpJyxcbiAgICAgICAgbGFiZWw6ICdUb3RhbCBMYW1iZGEgZXJyb3JzJyxcbiAgICAgICAgcGVyaW9kOiBtZXRyaWNQZXJpb2QsXG4gICAgICAgIHVzaW5nTWV0cmljczogT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgICAgIGFwcEZ1bmN0aW9ucy5tYXAoKGZuLCBpbmRleCkgPT4gW2BtJHtpbmRleCArIDF9YCwgZm4ubWV0cmljRXJyb3JzKHsgcGVyaW9kOiBtZXRyaWNQZXJpb2QgfSldKVxuICAgICAgICApXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fT1JfRVFVQUxfVE9fVEhSRVNIT0xELFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkdcbiAgICB9KTtcbiAgICBsYW1iZGFFcnJvckFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24oYWxlcnRUb3BpYykpO1xuXG4gICAgY29uc3QgaHR0cDV4eE1ldHJpYyA9IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICBuYW1lc3BhY2U6ICdBV1MvQXBpR2F0ZXdheScsXG4gICAgICBtZXRyaWNOYW1lOiAnNXh4JyxcbiAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgQXBpSWQ6IGh0dHBBcGkuYXBpSWQsXG4gICAgICAgIFN0YWdlOiAnJGRlZmF1bHQnXG4gICAgICB9LFxuICAgICAgc3RhdGlzdGljOiAnc3VtJyxcbiAgICAgIHBlcmlvZDogbWV0cmljUGVyaW9kXG4gICAgfSk7XG4gICAgY29uc3QgaHR0cDV4eEFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0h0dHBBcGk1eHhBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogYCR7cHJvamVjdE5hbWV9LSR7ZW52aXJvbm1lbnROYW1lfS1odHRwLWFwaS01eHhgLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FJUmVzUSBIVFRQIEFQSSByZXR1cm5lZCA1eHggcmVzcG9uc2VzLicsXG4gICAgICBtZXRyaWM6IGh0dHA1eHhNZXRyaWMsXG4gICAgICB0aHJlc2hvbGQ6IDEsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX09SX0VRVUFMX1RPX1RIUkVTSE9MRCxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSk7XG4gICAgaHR0cDV4eEFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24oYWxlcnRUb3BpYykpO1xuXG4gICAgY29uc3QgZHluYW1vVGhyb3R0bGVNZXRyaWMgPSAodGFibGU6IGR5bmFtb2RiLlRhYmxlLCBtZXRyaWNOYW1lOiBzdHJpbmcsIGxhYmVsOiBzdHJpbmcpID0+IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICBuYW1lc3BhY2U6ICdBV1MvRHluYW1vREInLFxuICAgICAgbWV0cmljTmFtZSxcbiAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgVGFibGVOYW1lOiB0YWJsZS50YWJsZU5hbWVcbiAgICAgIH0sXG4gICAgICBzdGF0aXN0aWM6ICdzdW0nLFxuICAgICAgcGVyaW9kOiBtZXRyaWNQZXJpb2QsXG4gICAgICBsYWJlbFxuICAgIH0pO1xuICAgIGNvbnN0IHJlcG9ydHNSZWFkVGhyb3R0bGVNZXRyaWMgPSBkeW5hbW9UaHJvdHRsZU1ldHJpYyhyZXBvcnRzVGFibGUsICdSZWFkVGhyb3R0bGVFdmVudHMnLCAnUmVwb3J0cyByZWFkIHRocm90dGxlcycpO1xuICAgIGNvbnN0IHJlcG9ydHNXcml0ZVRocm90dGxlTWV0cmljID0gZHluYW1vVGhyb3R0bGVNZXRyaWMocmVwb3J0c1RhYmxlLCAnV3JpdGVUaHJvdHRsZUV2ZW50cycsICdSZXBvcnRzIHdyaXRlIHRocm90dGxlcycpO1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zUmVhZFRocm90dGxlTWV0cmljID0gZHluYW1vVGhyb3R0bGVNZXRyaWMoY29ubmVjdGlvbnNUYWJsZSwgJ1JlYWRUaHJvdHRsZUV2ZW50cycsICdDb25uZWN0aW9ucyByZWFkIHRocm90dGxlcycpO1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zV3JpdGVUaHJvdHRsZU1ldHJpYyA9IGR5bmFtb1Rocm90dGxlTWV0cmljKGNvbm5lY3Rpb25zVGFibGUsICdXcml0ZVRocm90dGxlRXZlbnRzJywgJ0Nvbm5lY3Rpb25zIHdyaXRlIHRocm90dGxlcycpO1xuICAgIGNvbnN0IHJlcG9ydHNUaHJvdHRsZU1ldHJpYyA9IG5ldyBjbG91ZHdhdGNoLk1hdGhFeHByZXNzaW9uKHtcbiAgICAgIGV4cHJlc3Npb246ICdyZXBvcnRzUmVhZCArIHJlcG9ydHNXcml0ZScsXG4gICAgICBsYWJlbDogJ1JlcG9ydHMgdGFibGUgdGhyb3R0bGVzJyxcbiAgICAgIHBlcmlvZDogbWV0cmljUGVyaW9kLFxuICAgICAgdXNpbmdNZXRyaWNzOiB7XG4gICAgICAgIHJlcG9ydHNSZWFkOiByZXBvcnRzUmVhZFRocm90dGxlTWV0cmljLFxuICAgICAgICByZXBvcnRzV3JpdGU6IHJlcG9ydHNXcml0ZVRocm90dGxlTWV0cmljXG4gICAgICB9XG4gICAgfSk7XG4gICAgY29uc3QgY29ubmVjdGlvbnNUaHJvdHRsZU1ldHJpYyA9IG5ldyBjbG91ZHdhdGNoLk1hdGhFeHByZXNzaW9uKHtcbiAgICAgIGV4cHJlc3Npb246ICdjb25uZWN0aW9uc1JlYWQgKyBjb25uZWN0aW9uc1dyaXRlJyxcbiAgICAgIGxhYmVsOiAnQ29ubmVjdGlvbnMgdGFibGUgdGhyb3R0bGVzJyxcbiAgICAgIHBlcmlvZDogbWV0cmljUGVyaW9kLFxuICAgICAgdXNpbmdNZXRyaWNzOiB7XG4gICAgICAgIGNvbm5lY3Rpb25zUmVhZDogY29ubmVjdGlvbnNSZWFkVGhyb3R0bGVNZXRyaWMsXG4gICAgICAgIGNvbm5lY3Rpb25zV3JpdGU6IGNvbm5lY3Rpb25zV3JpdGVUaHJvdHRsZU1ldHJpY1xuICAgICAgfVxuICAgIH0pO1xuICAgIGNvbnN0IHRvdGFsRHluYW1vVGhyb3R0bGVNZXRyaWMgPSBuZXcgY2xvdWR3YXRjaC5NYXRoRXhwcmVzc2lvbih7XG4gICAgICBleHByZXNzaW9uOiAncmVwb3J0c1JlYWQgKyByZXBvcnRzV3JpdGUgKyBjb25uZWN0aW9uc1JlYWQgKyBjb25uZWN0aW9uc1dyaXRlJyxcbiAgICAgIGxhYmVsOiAnRHluYW1vREIgdGhyb3R0bGVkIGV2ZW50cycsXG4gICAgICBwZXJpb2Q6IG1ldHJpY1BlcmlvZCxcbiAgICAgIHVzaW5nTWV0cmljczoge1xuICAgICAgICByZXBvcnRzUmVhZDogcmVwb3J0c1JlYWRUaHJvdHRsZU1ldHJpYyxcbiAgICAgICAgcmVwb3J0c1dyaXRlOiByZXBvcnRzV3JpdGVUaHJvdHRsZU1ldHJpYyxcbiAgICAgICAgY29ubmVjdGlvbnNSZWFkOiBjb25uZWN0aW9uc1JlYWRUaHJvdHRsZU1ldHJpYyxcbiAgICAgICAgY29ubmVjdGlvbnNXcml0ZTogY29ubmVjdGlvbnNXcml0ZVRocm90dGxlTWV0cmljXG4gICAgICB9XG4gICAgfSk7XG4gICAgY29uc3QgZHluYW1vVGhyb3R0bGVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdEeW5hbW9UaHJvdHRsZUFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiBgJHtwcm9qZWN0TmFtZX0tJHtlbnZpcm9ubWVudE5hbWV9LWR5bmFtb2RiLXRocm90dGxlc2AsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQUlSZXNRIER5bmFtb0RCIHRhYmxlcyByZXBvcnRlZCB0aHJvdHRsZWQgcmVxdWVzdHMuJyxcbiAgICAgIG1ldHJpYzogdG90YWxEeW5hbW9UaHJvdHRsZU1ldHJpYyxcbiAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fT1JfRVFVQUxfVE9fVEhSRVNIT0xELFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkdcbiAgICB9KTtcbiAgICBkeW5hbW9UaHJvdHRsZUFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24oYWxlcnRUb3BpYykpO1xuXG4gICAgY29uc3QgbW9uaXRvcmVkQ29zdFNlcnZpY2VzID0gW1xuICAgICAgJ0FXUyBMYW1iZGEnLFxuICAgICAgJ0FtYXpvbiBBUEkgR2F0ZXdheScsXG4gICAgICAnQW1hem9uIER5bmFtb0RCJyxcbiAgICAgICdBbWF6b24gU2ltcGxlIFN0b3JhZ2UgU2VydmljZScsXG4gICAgICAnQW1hem9uIENvZ25pdG8nLFxuICAgICAgJ0FtYXpvbkNsb3VkV2F0Y2gnXG4gICAgXTtcbiAgICBjb25zdCBidWRnZXRTdWJzY3JpYmVyID0ge1xuICAgICAgYWRkcmVzczogYWxlcnRFbWFpbCxcbiAgICAgIHN1YnNjcmlwdGlvblR5cGU6ICdFTUFJTCdcbiAgICB9O1xuICAgIG5ldyBidWRnZXRzLkNmbkJ1ZGdldCh0aGlzLCAnUHJvamVjdE1vbnRobHlCdWRnZXQnLCB7XG4gICAgICBidWRnZXQ6IHtcbiAgICAgICAgYnVkZ2V0TmFtZTogYCR7cHJvamVjdE5hbWV9LSR7ZW52aXJvbm1lbnROYW1lfS1zZXJ2ZXJsZXNzLXNlcnZpY2VzLW1vbnRobHlgLFxuICAgICAgICBidWRnZXRUeXBlOiAnQ09TVCcsXG4gICAgICAgIHRpbWVVbml0OiAnTU9OVEhMWScsXG4gICAgICAgIGJ1ZGdldExpbWl0OiB7XG4gICAgICAgICAgYW1vdW50OiBtb250aGx5QnVkZ2V0VXNkLFxuICAgICAgICAgIHVuaXQ6ICdVU0QnXG4gICAgICAgIH0sXG4gICAgICAgIGZpbHRlckV4cHJlc3Npb246IHtcbiAgICAgICAgICBhbmQ6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdGFnczoge1xuICAgICAgICAgICAgICAgIGtleTogJ1Byb2plY3QnLFxuICAgICAgICAgICAgICAgIHZhbHVlczogW3Byb2plY3ROYW1lXSxcbiAgICAgICAgICAgICAgICBtYXRjaE9wdGlvbnM6IFsnRVFVQUxTJ11cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgZGltZW5zaW9uczoge1xuICAgICAgICAgICAgICAgIGtleTogJ1NFUlZJQ0UnLFxuICAgICAgICAgICAgICAgIHZhbHVlczogbW9uaXRvcmVkQ29zdFNlcnZpY2VzLFxuICAgICAgICAgICAgICAgIG1hdGNoT3B0aW9uczogWydFUVVBTFMnXVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgbm90aWZpY2F0aW9uc1dpdGhTdWJzY3JpYmVyczogW1xuICAgICAgICB7XG4gICAgICAgICAgbm90aWZpY2F0aW9uOiB7XG4gICAgICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6ICdHUkVBVEVSX1RIQU4nLFxuICAgICAgICAgICAgbm90aWZpY2F0aW9uVHlwZTogJ0FDVFVBTCcsXG4gICAgICAgICAgICB0aHJlc2hvbGQ6IDgwLFxuICAgICAgICAgICAgdGhyZXNob2xkVHlwZTogJ1BFUkNFTlRBR0UnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdWJzY3JpYmVyczogW2J1ZGdldFN1YnNjcmliZXJdXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBub3RpZmljYXRpb246IHtcbiAgICAgICAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogJ0dSRUFURVJfVEhBTicsXG4gICAgICAgICAgICBub3RpZmljYXRpb25UeXBlOiAnRk9SRUNBU1RFRCcsXG4gICAgICAgICAgICB0aHJlc2hvbGQ6IDEwMCxcbiAgICAgICAgICAgIHRocmVzaG9sZFR5cGU6ICdQRVJDRU5UQUdFJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgc3Vic2NyaWJlcnM6IFtidWRnZXRTdWJzY3JpYmVyXVxuICAgICAgICB9XG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VUYWdzOiBbXG4gICAgICAgIHsga2V5OiAnUHJvamVjdCcsIHZhbHVlOiBwcm9qZWN0TmFtZSB9LFxuICAgICAgICB7IGtleTogJ0Vudmlyb25tZW50JywgdmFsdWU6IGVudmlyb25tZW50TmFtZSB9XG4gICAgICBdXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb3N0QW5vbWFseU1vbml0b3IgPSBuZXcgY2UuQ2ZuQW5vbWFseU1vbml0b3IodGhpcywgJ1NlcnZpY2VDb3N0QW5vbWFseU1vbml0b3InLCB7XG4gICAgICBtb25pdG9yTmFtZTogYCR7cHJvamVjdE5hbWV9LSR7ZW52aXJvbm1lbnROYW1lfS1zZXJ2aWNlLWNvc3RzYCxcbiAgICAgIG1vbml0b3JUeXBlOiAnQ1VTVE9NJyxcbiAgICAgIG1vbml0b3JTcGVjaWZpY2F0aW9uOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIFRhZ3M6IHtcbiAgICAgICAgICBLZXk6ICdQcm9qZWN0JyxcbiAgICAgICAgICBWYWx1ZXM6IFtwcm9qZWN0TmFtZV1cbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgICByZXNvdXJjZVRhZ3M6IFtcbiAgICAgICAgeyBrZXk6ICdQcm9qZWN0JywgdmFsdWU6IHByb2plY3ROYW1lIH0sXG4gICAgICAgIHsga2V5OiAnRW52aXJvbm1lbnQnLCB2YWx1ZTogZW52aXJvbm1lbnROYW1lIH1cbiAgICAgIF1cbiAgICB9KTtcbiAgICBuZXcgY2UuQ2ZuQW5vbWFseVN1YnNjcmlwdGlvbih0aGlzLCAnU2VydmljZUNvc3RBbm9tYWx5U3Vic2NyaXB0aW9uJywge1xuICAgICAgc3Vic2NyaXB0aW9uTmFtZTogYCR7cHJvamVjdE5hbWV9LSR7ZW52aXJvbm1lbnROYW1lfS1jb3N0LWFub21hbGllc2AsXG4gICAgICBmcmVxdWVuY3k6ICdEQUlMWScsXG4gICAgICBtb25pdG9yQXJuTGlzdDogW2Nvc3RBbm9tYWx5TW9uaXRvci5hdHRyTW9uaXRvckFybl0sXG4gICAgICB0aHJlc2hvbGRFeHByZXNzaW9uOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIERpbWVuc2lvbnM6IHtcbiAgICAgICAgICBLZXk6ICdBTk9NQUxZX1RPVEFMX0lNUEFDVF9BQlNPTFVURScsXG4gICAgICAgICAgTWF0Y2hPcHRpb25zOiBbJ0dSRUFURVJfVEhBTl9PUl9FUVVBTCddLFxuICAgICAgICAgIFZhbHVlczogW1N0cmluZyhhbm9tYWx5VGhyZXNob2xkVXNkKV1cbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgICBzdWJzY3JpYmVyczogW1xuICAgICAgICB7XG4gICAgICAgICAgYWRkcmVzczogYWxlcnRFbWFpbCxcbiAgICAgICAgICB0eXBlOiAnRU1BSUwnXG4gICAgICAgIH1cbiAgICAgIF0sXG4gICAgICByZXNvdXJjZVRhZ3M6IFtcbiAgICAgICAgeyBrZXk6ICdQcm9qZWN0JywgdmFsdWU6IHByb2plY3ROYW1lIH0sXG4gICAgICAgIHsga2V5OiAnRW52aXJvbm1lbnQnLCB2YWx1ZTogZW52aXJvbm1lbnROYW1lIH1cbiAgICAgIF1cbiAgICB9KTtcblxuICAgIGNvbnN0IGh0dHBEaW1lbnNpb25zID0ge1xuICAgICAgQXBpSWQ6IGh0dHBBcGkuYXBpSWQsXG4gICAgICBTdGFnZTogJyRkZWZhdWx0J1xuICAgIH07XG4gICAgY29uc3Qgd3NEaW1lbnNpb25zID0ge1xuICAgICAgQXBpSWQ6IHdzQXBpLmFwaUlkLFxuICAgICAgU3RhZ2U6IHdzU3RhZ2Uuc3RhZ2VOYW1lXG4gICAgfTtcbiAgICBjb25zdCBkYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5EYXNoYm9hcmQodGhpcywgJ09wZXJhdGlvbnNEYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiBgJHtwcm9qZWN0TmFtZX0tJHtlbnZpcm9ubWVudE5hbWV9LXNlcnZlcmxlc3MtdXNhZ2VgXG4gICAgfSk7XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMobmV3IGNsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICBtYXJrZG93bjogW1xuICAgICAgICBgIyAke3Byb2plY3ROYW1lfSAke2Vudmlyb25tZW50TmFtZX0gbW9uaXRvcmluZ2AsXG4gICAgICAgICcnLFxuICAgICAgICBgQnVkZ2V0IGFsZXJ0IGVtYWlsOiAke2FsZXJ0RW1haWx9YCxcbiAgICAgICAgYE1vbnRobHkgc2VydmljZXMgYnVkZ2V0OiAkJHttb250aGx5QnVkZ2V0VXNkfWAsXG4gICAgICAgIGBDb3N0IGFub21hbHkgdGhyZXNob2xkOiAkJHthbm9tYWx5VGhyZXNob2xkVXNkfWAsXG4gICAgICAgICcnLFxuICAgICAgICAnQ29zdCBkYXRhIGFwcGVhcnMgaW4gQVdTIENvc3QgRXhwbG9yZXIvQnVkZ2V0cyBhZnRlciBiaWxsaW5nIHByb2Nlc3NpbmcuIFVzZSBDb3N0IEV4cGxvcmVyIGdyb3VwZWQgYnkgU2VydmljZSBvciBieSB0aGUgYWN0aXZhdGVkIFByb2plY3QvRW52aXJvbm1lbnQgY29zdCBhbGxvY2F0aW9uIHRhZ3MgZm9yIHNlcnZpY2UtbGV2ZWwgc3BlbmQuJ1xuICAgICAgXS5qb2luKCdcXG4nKSxcbiAgICAgIHdpZHRoOiAyNCxcbiAgICAgIGhlaWdodDogNVxuICAgIH0pKTtcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdIVFRQIEFQSSB1c2FnZSBhbmQgZXJyb3JzJyxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9BcGlHYXRld2F5JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdDb3VudCcsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiBodHRwRGltZW5zaW9ucyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ3N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IG1ldHJpY1BlcmlvZCxcbiAgICAgICAgICAgIGxhYmVsOiAnSFRUUCByZXF1ZXN0cydcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0FwaUdhdGV3YXknLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJzR4eCcsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiBodHRwRGltZW5zaW9ucyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ3N1bScsXG4gICAgICAgICAgICBwZXJpb2Q6IG1ldHJpY1BlcmlvZCxcbiAgICAgICAgICAgIGxhYmVsOiAnSFRUUCA0eHgnXG4gICAgICAgICAgfSksXG4gICAgICAgICAgaHR0cDV4eE1ldHJpYy53aXRoKHsgbGFiZWw6ICdIVFRQIDV4eCcgfSlcbiAgICAgICAgXVxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnSFRUUCBBUEkgbGF0ZW5jeScsXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvQXBpR2F0ZXdheScsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnTGF0ZW5jeScsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiBodHRwRGltZW5zaW9ucyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ2F2ZycsXG4gICAgICAgICAgICBwZXJpb2Q6IG1ldHJpY1BlcmlvZCxcbiAgICAgICAgICAgIGxhYmVsOiAnQXZlcmFnZSBsYXRlbmN5J1xuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvQXBpR2F0ZXdheScsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnSW50ZWdyYXRpb25MYXRlbmN5JyxcbiAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IGh0dHBEaW1lbnNpb25zLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnYXZnJyxcbiAgICAgICAgICAgIHBlcmlvZDogbWV0cmljUGVyaW9kLFxuICAgICAgICAgICAgbGFiZWw6ICdJbnRlZ3JhdGlvbiBsYXRlbmN5J1xuICAgICAgICAgIH0pXG4gICAgICAgIF1cbiAgICAgIH0pXG4gICAgKTtcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdMYW1iZGEgaW52b2NhdGlvbnMnLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGxlZnQ6IGFwcEZ1bmN0aW9ucy5tYXAoKGZuKSA9PiBmbi5tZXRyaWNJbnZvY2F0aW9ucyh7IHBlcmlvZDogbWV0cmljUGVyaW9kLCBzdGF0aXN0aWM6ICdzdW0nIH0pKVxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnTGFtYmRhIGVycm9ycyBhbmQgZHVyYXRpb24nLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGxlZnQ6IGFwcEZ1bmN0aW9ucy5tYXAoKGZuKSA9PiBmbi5tZXRyaWNFcnJvcnMoeyBwZXJpb2Q6IG1ldHJpY1BlcmlvZCwgc3RhdGlzdGljOiAnc3VtJyB9KSksXG4gICAgICAgIHJpZ2h0OiBhcHBGdW5jdGlvbnMubWFwKChmbikgPT4gZm4ubWV0cmljRHVyYXRpb24oeyBwZXJpb2Q6IG1ldHJpY1BlcmlvZCwgc3RhdGlzdGljOiAnYXZnJyB9KSlcbiAgICAgIH0pXG4gICAgKTtcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdEeW5hbW9EQiByZWFkL3dyaXRlIHVzYWdlJyxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgcmVwb3J0c1RhYmxlLm1ldHJpY0NvbnN1bWVkUmVhZENhcGFjaXR5VW5pdHMoeyBwZXJpb2Q6IG1ldHJpY1BlcmlvZCwgc3RhdGlzdGljOiAnc3VtJywgbGFiZWw6ICdSZXBvcnRzIHJlYWRzJyB9KSxcbiAgICAgICAgICByZXBvcnRzVGFibGUubWV0cmljQ29uc3VtZWRXcml0ZUNhcGFjaXR5VW5pdHMoeyBwZXJpb2Q6IG1ldHJpY1BlcmlvZCwgc3RhdGlzdGljOiAnc3VtJywgbGFiZWw6ICdSZXBvcnRzIHdyaXRlcycgfSksXG4gICAgICAgICAgY29ubmVjdGlvbnNUYWJsZS5tZXRyaWNDb25zdW1lZFJlYWRDYXBhY2l0eVVuaXRzKHsgcGVyaW9kOiBtZXRyaWNQZXJpb2QsIHN0YXRpc3RpYzogJ3N1bScsIGxhYmVsOiAnQ29ubmVjdGlvbnMgcmVhZHMnIH0pLFxuICAgICAgICAgIGNvbm5lY3Rpb25zVGFibGUubWV0cmljQ29uc3VtZWRXcml0ZUNhcGFjaXR5VW5pdHMoeyBwZXJpb2Q6IG1ldHJpY1BlcmlvZCwgc3RhdGlzdGljOiAnc3VtJywgbGFiZWw6ICdDb25uZWN0aW9ucyB3cml0ZXMnIH0pXG4gICAgICAgIF1cbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0R5bmFtb0RCIHRocm90dGxlcycsXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIHJlcG9ydHNUaHJvdHRsZU1ldHJpYyxcbiAgICAgICAgICBjb25uZWN0aW9uc1Rocm90dGxlTWV0cmljXG4gICAgICAgIF1cbiAgICAgIH0pXG4gICAgKTtcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdTMyBwaG90byBzdG9yYWdlJyxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9TMycsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnQnVja2V0U2l6ZUJ5dGVzJyxcbiAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICAgICAgQnVja2V0TmFtZTogcGhvdG9zQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgICAgICAgIFN0b3JhZ2VUeXBlOiAnU3RhbmRhcmRTdG9yYWdlJ1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ2F2ZXJhZ2UnLFxuICAgICAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5kYXlzKDEpLFxuICAgICAgICAgICAgbGFiZWw6ICdQaG90byBzdG9yYWdlIGJ5dGVzJ1xuICAgICAgICAgIH0pXG4gICAgICAgIF0sXG4gICAgICAgIHJpZ2h0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9TMycsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnTnVtYmVyT2ZPYmplY3RzJyxcbiAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICAgICAgQnVja2V0TmFtZTogcGhvdG9zQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgICAgICAgIFN0b3JhZ2VUeXBlOiAnQWxsU3RvcmFnZVR5cGVzJ1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ2F2ZXJhZ2UnLFxuICAgICAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5kYXlzKDEpLFxuICAgICAgICAgICAgbGFiZWw6ICdQaG90byBvYmplY3QgY291bnQnXG4gICAgICAgICAgfSlcbiAgICAgICAgXVxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnV2ViU29ja2V0IGxpdmUtbWFwIHVzYWdlJyxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9BcGlHYXRld2F5JyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdDb25uZWN0Q291bnQnLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDogd3NEaW1lbnNpb25zLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnc3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogbWV0cmljUGVyaW9kLFxuICAgICAgICAgICAgbGFiZWw6ICdDb25uZWN0cydcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0FwaUdhdGV3YXknLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ01lc3NhZ2VDb3VudCcsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB3c0RpbWVuc2lvbnMsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdzdW0nLFxuICAgICAgICAgICAgcGVyaW9kOiBtZXRyaWNQZXJpb2QsXG4gICAgICAgICAgICBsYWJlbDogJ01lc3NhZ2VzJ1xuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvQXBpR2F0ZXdheScsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnQ2xpZW50RXJyb3InLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDogd3NEaW1lbnNpb25zLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnc3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogbWV0cmljUGVyaW9kLFxuICAgICAgICAgICAgbGFiZWw6ICdDbGllbnQgZXJyb3JzJ1xuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvQXBpR2F0ZXdheScsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnRXhlY3V0aW9uRXJyb3InLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDogd3NEaW1lbnNpb25zLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnc3VtJyxcbiAgICAgICAgICAgIHBlcmlvZDogbWV0cmljUGVyaW9kLFxuICAgICAgICAgICAgbGFiZWw6ICdFeGVjdXRpb24gZXJyb3JzJ1xuICAgICAgICAgIH0pXG4gICAgICAgIF1cbiAgICAgIH0pXG4gICAgKTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlCYXNlVXJsJywgeyB2YWx1ZTogaHR0cEFwaS5hcGlFbmRwb2ludCB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnV2ViU29ja2V0VXJsJywgeyB2YWx1ZTogd3NTdGFnZS51cmwgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NvZ25pdG9Vc2VyUG9vbElkJywgeyB2YWx1ZTogdXNlclBvb2wudXNlclBvb2xJZCB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ29nbml0b1VzZXJQb29sQ2xpZW50SWQnLCB7IHZhbHVlOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkIH0pO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZXBvcnRzVGFibGVOYW1lJywgeyB2YWx1ZTogcmVwb3J0c1RhYmxlLnRhYmxlTmFtZSB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUGhvdG9zQnVja2V0TmFtZScsIHsgdmFsdWU6IHBob3Rvc0J1Y2tldC5idWNrZXROYW1lIH0pO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNb25pdG9yaW5nRGFzaGJvYXJkTmFtZScsIHsgdmFsdWU6IGRhc2hib2FyZC5kYXNoYm9hcmROYW1lIH0pO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNb25pdG9yaW5nRGFzaGJvYXJkVXJsJywge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7dGhpcy5yZWdpb259LmNvbnNvbGUuYXdzLmFtYXpvbi5jb20vY2xvdWR3YXRjaC9ob21lP3JlZ2lvbj0ke3RoaXMucmVnaW9ufSNkYXNoYm9hcmRzOm5hbWU9JHtkYXNoYm9hcmQuZGFzaGJvYXJkTmFtZX1gXG4gICAgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ01vbml0b3JpbmdBbGVydEVtYWlsJywgeyB2YWx1ZTogYWxlcnRFbWFpbCB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTW9udGhseUJ1ZGdldFVzZCcsIHsgdmFsdWU6IFN0cmluZyhtb250aGx5QnVkZ2V0VXNkKSB9KTtcbiAgfVxufVxuIl19