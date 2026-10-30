#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { HarnessInterviewStack } from '../lib/harness-interview-stack';

const app = new cdk.App();

new HarnessInterviewStack(app, 'HarnessInterviewStack', {
  description: 'Harness Interview MCP Server infrastructure',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
