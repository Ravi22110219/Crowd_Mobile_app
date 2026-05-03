#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AiresqNativeAwsStack } from '../lib/airesq-native-aws-stack';

const app = new cdk.App();

new AiresqNativeAwsStack(app, 'AiresqNativeAwsStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-south-1'
  }
});
