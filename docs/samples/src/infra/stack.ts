// infra/lib/*.ts の抜粋 — L1 の CfnNetworkConnector / CfnMicrovmImage と、durableConfig を使う Lambda
import { App, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';

export class NetworkAndEngineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'proxy', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'mvm-runtime', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 22 }, // NAT へのルートなし
        { name: 'mvm-build', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    const runtimeSg = new ec2.SecurityGroup(this, 'MvmRuntimeSg', { vpc, allowAllOutbound: false });

    const operatorRole = new iam.Role(this, 'NetworkConnectorOperatorRole', {
      assumedBy: new iam.ServicePrincipal('network-connectors.lambda.amazonaws.com'), // PoC で信頼ポリシーを確認する
    });

    new lambda.CfnNetworkConnector(this, 'RuntimeConnector', {
      name: 'factory-mvm-runtime',
      operatorRole: operatorRole.roleArn,
      configuration: {
        vpcEgressConfiguration: {
          subnetIds: vpc.selectSubnets({ subnetGroupName: 'mvm-runtime' }).subnetIds,
          securityGroupIds: [runtimeSg.securityGroupId],
          networkProtocol: 'IPv4',
          associatedComputeResourceTypes: ['MicroVm'],
        },
      },
    });

    const buildRole = new iam.Role(this, 'MicrovmBuildRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'), // PoC で MicroVMs のサービスプリンシパルを確認する
    });

    // 既定のイメージ（CDK 2.275 の型では tags 以外が必須なので、すべて明示する）
    new lambda.CfnMicrovmImage(this, 'BaseImage', {
      name: 'base',
      description: 'factory-base + git / Claude Code / Node / Python',
      baseImageArn: 'arn:aws:lambda:ap-northeast-1:aws:microvm-image:al2023-1', // ListManagedMicrovmImages で確認する
      baseImageVersion: '1',
      buildRoleArn: buildRole.roleArn,
      codeArtifact: { uri: 's3://factory-build-artifacts/base/v7/build.zip' },
      cpuConfigurations: [{ architecture: 'ARM_64' }], // CloudFormation の値は ARM_64（API の enum は ARM64 で、表記が違う）
      resources: [{ minimumMemoryInMiB: 2048 }],
      egressNetworkConnectors: [],
      environmentVariables: [{ key: 'FACTORY_IMAGE', value: 'base@7' }],
      hooks: {
        port: 8080,
        microvmImageHooks: { ready: 'ENABLED', readyTimeoutInSeconds: 600, validate: 'ENABLED', validateTimeoutInSeconds: 600 },
        microvmHooks: { run: 'ENABLED', suspend: 'ENABLED', resume: 'ENABLED', terminate: 'ENABLED' },
      },
      logging: {},
      additionalOsCapabilities: [],
    });

    // ライン実行エンジン（Lambda durable functions）
    new lambda.Function(this, 'LineEngine', {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {}'), // 実装では NodejsFunction（esbuild）で束ねる
      timeout: Duration.minutes(15),
      durableConfig: { executionTimeout: Duration.days(30), retentionPeriod: Duration.days(30) },
    });
  }
}

const app = new App({ outdir: 'cdk.out' });
new NetworkAndEngineStack(app, 'FactoryVerify', { env: { account: '123456789012', region: 'ap-northeast-1' } });
const asm = app.synth();
const tpl = asm.getStackByName('FactoryVerify').template as { Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }> };
const types = Object.values(tpl.Resources).map((r) => r.Type);
for (const t of ['AWS::Lambda::NetworkConnector', 'AWS::Lambda::MicrovmImage', 'AWS::Lambda::Function']) {
  console.log(t, types.filter((x) => x === t).length);
}
const fn = Object.values(tpl.Resources).find((r) => r.Type === 'AWS::Lambda::Function' && r.Properties?.['DurableConfig']);
console.log('DurableConfig', JSON.stringify(fn?.Properties?.['DurableConfig']));
