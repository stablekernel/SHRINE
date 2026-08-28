import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
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

    // Lambda function for MCP server (TypeScript with esbuild)
    const mcpServerFunction = new NodejsFunction(this, 'McpServerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../../harness-interview/server/src/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        INTERVIEW_BUCKET: interviewBucket.bucketName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      description: 'Harness Interview MCP Server',
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        // AWS SDK v3 is included in Lambda runtime
        externalModules: ['@aws-sdk/*'],
        // Include prompts directory as an asset
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string): string[] {
            return [`cp -r ${inputDir}/../prompts ${outputDir}/prompts`];
          },
          afterBundling(): string[] {
            return [];
          },
          beforeInstall(): string[] {
            return [];
          },
        },
      },
    });

    // Grant Lambda write access to S3 bucket
    interviewBucket.grantWrite(mcpServerFunction);

    // Function URL with CORS for OAuth redirect flow
    // Note: Wide CORS is intentional - harnesses run from various origins (local IDEs,
    // web apps, CLI tools). Security is enforced at the application layer via Google OAuth
    // with @stablekernel.com domain restriction. Consider WAF if abuse observed.
    const functionUrl = mcpServerFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['https://claude.ai', 'https://cursor.sh', 'http://localhost:*'],
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
