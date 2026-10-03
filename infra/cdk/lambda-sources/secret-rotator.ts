// Sole owner of jwtSecret and ipHashSecret SecureStrings. These values are
// generated once on stack CREATE, preserved on ordinary UPDATE (if the
// SSM parameter already exists we read it and leave it alone), and deleted
// on stack DELETE. Rotation must be explicit — this handler never regenerates
// a secret just because CDK ran again.
//
// CDK is deliberately NOT the owner of AWS::SSM::Parameter resources for
// these two values; letting CDK and this handler both manage them would
// create ordering ambiguity on UPDATE.
import { randomBytes } from 'node:crypto'
import {
  SSMClient,
  PutParameterCommand,
  GetParameterCommand,
  DeleteParameterCommand,
  ParameterNotFound,
} from '@aws-sdk/client-ssm'
import type { CloudFormationCustomResourceEvent } from 'aws-lambda'

const ssm = new SSMClient({})

interface Props {
  jwtSecretName: string
  ipHashSecretName: string
}

function readProps(event: CloudFormationCustomResourceEvent): Props {
  const p = event.ResourceProperties as Record<string, string>
  return { jwtSecretName: p.jwtSecretName, ipHashSecretName: p.ipHashSecretName }
}

async function ensureSecret(name: string): Promise<void> {
  try {
    await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }))
    return
  } catch (err) {
    if (!(err instanceof ParameterNotFound)) throw err
  }
  const value = randomBytes(48).toString('base64url')
  await ssm.send(new PutParameterCommand({
    Name: name,
    Type: 'SecureString',
    Value: value,
    Overwrite: false,
  }))
}

async function deleteSecretIfExists(name: string): Promise<void> {
  try {
    await ssm.send(new DeleteParameterCommand({ Name: name }))
  } catch (err) {
    if (err instanceof ParameterNotFound) return
    throw err
  }
}

export async function handler(event: CloudFormationCustomResourceEvent): Promise<{ PhysicalResourceId: string }> {
  const props = readProps(event)
  const physicalId = `secret-rotator-${props.jwtSecretName}`

  if (event.RequestType === 'Delete') {
    await deleteSecretIfExists(props.jwtSecretName)
    await deleteSecretIfExists(props.ipHashSecretName)
    return { PhysicalResourceId: physicalId }
  }

  // Create AND Update: ensure both exist; leave existing values intact.
  await ensureSecret(props.jwtSecretName)
  await ensureSecret(props.ipHashSecretName)
  return { PhysicalResourceId: physicalId }
}
