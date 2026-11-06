// packages/vm-manager/src/run.ts — RunMicrovm の呼び出し（SDK の型で引数を検証する）
import { LambdaMicrovmsClient, RunMicrovmCommand, CreateMicrovmAuthTokenCommand } from '@aws-sdk/client-lambda-microvms';

const client = new LambdaMicrovmsClient({});

export async function runStageVm(args: {
  imageName: string; imageVersion: string; executionRoleArn: string;
  runtimeConnectorArn: string; ingressConnectorArn: string;
  workItemId: string; runId: string; payload: Record<string, unknown>;
}) {
  const out = await client.send(new RunMicrovmCommand({
    imageIdentifier: args.imageName,
    imageVersion: args.imageVersion,                 // バージョンを固定する（FR-IMG-07）
    executionRoleArn: args.executionRoleArn,
    egressNetworkConnectors: [args.runtimeConnectorArn],
    ingressNetworkConnectors: [args.ingressConnectorArn],
    idlePolicy: { maxIdleDurationSeconds: 900, suspendedDurationSeconds: 7_200, autoResumeEnabled: true },
    maximumDurationInSeconds: 8 * 60 * 60,
    runHookPayload: JSON.stringify(args.payload),    // vmToken などは snapshot に入れず、ここで渡す
    clientToken: `${args.workItemId}:${args.runId}`, // 再試行しても二重に起動しない
  }));
  return { microvmId: out.microvmId, endpoint: out.endpoint, state: out.state };
}

export async function issueEndpointToken(microvmId: string, port: number) {
  const out = await client.send(new CreateMicrovmAuthTokenCommand({
    microvmIdentifier: microvmId,
    expirationInMinutes: 30,
    allowedPorts: [{ port }],
  }));
  return out.authToken?.['X-aws-proxy-auth'];
}
