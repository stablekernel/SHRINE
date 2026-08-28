import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export class HarnessInterviewStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for interview submissions (Hive-partitioned: version=/date=/)
    const interviewBucket = new s3.Bucket(this, 'InterviewBucket', {
      bucketName: `shrine-harness-interviews-${cdk.Aws.ACCOUNT_ID}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'TransitionToIA',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // Lambda function for MCP server
    const mcpServerFunction = new lambda.Function(this, 'McpServerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../server')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        INTERVIEW_BUCKET: interviewBucket.bucketName,
      },
      description: 'Harness Interview MCP Server',
    });

    // Grant Lambda write access to S3 bucket
    interviewBucket.grantWrite(mcpServerFunction);

    // Function URL with CORS for OAuth redirect flow
    const functionUrl = mcpServerFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        maxAge: cdk.Duration.days(1),
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'FunctionUrl', {
      value: functionUrl.url,
      description: 'Lambda Function URL for MCP Server',
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: interviewBucket.bucketName,
      description: 'S3 Bucket for interview submissions',
    });

    new cdk.CfnOutput(this, 'BucketArn', {
      value: interviewBucket.bucketArn,
      description: 'S3 Bucket ARN',
    });
  }
}
