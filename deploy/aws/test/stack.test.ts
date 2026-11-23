import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { describe, expect, it } from 'vitest'
import { assertNoSecrets, type DeployConfig, validateConfig } from '../src/config.js'
import { CarteroStack, TASK_BOOTSTRAP } from '../src/stack/cartero-stack.js'

const IMAGE =
  'ghcr.io/elrincondeisma/cartero@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function base(over: Partial<DeployConfig> = {}): DeployConfig {
  return {
    version: 1,
    stackName: 'Cartero',
    account: '123456789012',
    region: 'eu-west-1',
    compute: 'fargate',
    image: IMAGE,
    network: { mode: 'new' },
    database: { mode: 'new' },
    cache: { mode: 'new' },
    domain: { mode: 'none' },
    admin: { emails: ['ana@example.com'], allowRegistration: false },
    allowExistingSgIngress: false,
    cloudfrontPrefixListId: 'pl-4fa04526',
    ...over,
  }
}

const EXISTING_NET = {
  mode: 'existing' as const,
  vpcId: 'vpc-0a1b2c3d4e5f60718',
  publicSubnets: [
    { id: 'subnet-0aaaaaaaaaaaaaaa1', az: 'eu-west-1a' },
    { id: 'subnet-0aaaaaaaaaaaaaaa2', az: 'eu-west-1b' },
  ],
  privateSubnets: [
    { id: 'subnet-0bbbbbbbbbbbbbbb1', az: 'eu-west-1a' },
    { id: 'subnet-0bbbbbbbbbbbbbbb2', az: 'eu-west-1b' },
  ],
}
const EXISTING_DB = {
  mode: 'existing' as const,
  host: 'mydb.abc.eu-west-1.rds.amazonaws.com',
  port: 5432,
  name: 'cartero',
  secretArn: 'arn:aws:secretsmanager:eu-west-1:123456789012:secret:rds!db-1234-AbCdEf',
  securityGroupId: 'sg-0d0d0d0d0d0d0d0d0',
  ssl: true,
}

function synth(c: DeployConfig) {
  expect(validateConfig(c)).toEqual([])
  const app = new App()
  const stack = new CarteroStack(app, c.stackName, {
    config: c,
    env: { account: c.account, region: c.region },
  })
  return Template.fromStack(stack)
}

/** Ninguna variable de entorno de la tarea ni el user data llevan contraseñas en claro. */
/** Variables de entorno del contenedor de la tarea, sin depender del orden. */
function taskEnv(t: Template): Record<string, string> {
  const [td] = Object.values(t.findResources('AWS::ECS::TaskDefinition')) as any[]
  return Object.fromEntries(
    td.Properties.ContainerDefinitions[0].Environment.map((e: any) => [e.Name, e.Value]),
  )
}

function expectNoPlainSecrets(t: Template) {
  const json = JSON.stringify(t.toJSON())
  expect(json).not.toMatch(/"Name":"(DB_PASS|CARTERO_SECRET_KEY|REDIS_PASS)","Value"/)
  expect(json).not.toMatch(/POSTGRES_PASSWORD=[^$\\']/)
}

/** EC2 solo acepta este juego de caracteres en las descripciones de grupos y reglas (sin tildes). */
const SG_TEXT = /^[a-zA-Z0-9. _\-:/()#,@[\]+=&;{}!$*]*$/

function expectAwsSafeSgDescriptions(t: Template) {
  const texts: string[] = []
  for (const type of [
    'AWS::EC2::SecurityGroup',
    'AWS::EC2::SecurityGroupIngress',
    'AWS::EC2::SecurityGroupEgress',
  ]) {
    for (const r of Object.values(t.findResources(type)) as any[]) {
      const p = r.Properties ?? {}
      for (const v of [p.GroupDescription, p.Description]) if (typeof v === 'string') texts.push(v)
      for (const rule of [...(p.SecurityGroupIngress ?? []), ...(p.SecurityGroupEgress ?? [])])
        if (typeof rule.Description === 'string') texts.push(rule.Description)
    }
  }
  expect(texts.length).toBeGreaterThan(0)
  for (const text of texts) expect(text).toMatch(SG_TEXT)
}

describe('Fargate, todo nuevo y sin dominio (CloudFront)', () => {
  const t = synth(base())

  it('las descripciones de los grupos de seguridad son aceptables para EC2', () =>
    expectAwsSafeSgDescriptions(t))

  it('crea la red sin NAT, RDS, Valkey, EFS y una sola tarea', () => {
    t.resourceCountIs('AWS::EC2::VPC', 1)
    t.resourceCountIs('AWS::EC2::NatGateway', 0)
    t.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      DBInstanceClass: 'db.t4g.micro',
      StorageEncrypted: true,
    })
    t.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
      Engine: 'valkey',
      CacheNodeType: 'cache.t4g.micro',
      TransitEncryptionEnabled: true,
    })
    t.hasResourceProperties('AWS::EFS::FileSystem', { Encrypted: true })
    t.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 1, LaunchType: 'FARGATE' })
    t.resourceCountIs('AWS::CloudFront::Distribution', 1)
  })

  it('conserva los datos al destruir: snapshot de RDS, EFS y la clave', () => {
    t.hasResource('AWS::RDS::DBInstance', { DeletionPolicy: 'Snapshot' })
    t.hasResource('AWS::EFS::FileSystem', { DeletionPolicy: 'Retain' })
    t.hasResource('AWS::SecretsManager::Secret', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({ Description: 'CARTERO_SECRET_KEY de Cartero' }),
    })
  })

  it('el ALB solo acepta a CloudFront, aguanta el WebSocket y comprueba /api/health', () => {
    t.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      SourcePrefixListId: 'pl-4fa04526',
      FromPort: 80,
    })
    // Nada abierto a todo Internet en el ALB
    expect(JSON.stringify(t.findResources('AWS::EC2::SecurityGroup'))).not.toContain(
      '0.0.0.0/0","Description":"CloudFront',
    )
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      LoadBalancerAttributes: Match.arrayWith([{ Key: 'idle_timeout.timeout_seconds', Value: '120' }]),
    })
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', { HealthCheckPath: '/api/health' })
  })

  it('la tarea compone las URL al arrancar y recibe los secretos de Secrets Manager', () => {
    t.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: [
        Match.objectLike({
          Image: IMAGE,
          Command: ['node', '--input-type=module', '-e', TASK_BOOTSTRAP],
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: 'CARTERO_SECRET_KEY' }),
            Match.objectLike({ Name: 'DB_USER' }),
            Match.objectLike({ Name: 'DB_PASS' }),
          ]),
          MountPoints: [{ ContainerPath: '/data/files', SourceVolume: 'files', ReadOnly: false }],
        }),
      ],
    })
    expect(taskEnv(t)).toMatchObject({ DB_SSL: 'true', REDIS_TLS: 'true', ALLOW_REGISTRATION: 'false' })
    // Con GuardDuty Runtime Monitoring, ECS descarga su agente de ECR con el rol de ejecución
    expect(JSON.stringify(t.findResources('AWS::IAM::Role'))).toContain(
      'service-role/AmazonECSTaskExecutionRolePolicy',
    )
    expectNoPlainSecrets(t)
  })
})

describe('Fargate reutilizando VPC, RDS, Redis, zona y certificado', () => {
  const t = synth(
    base({
      network: EXISTING_NET,
      database: EXISTING_DB,
      cache: {
        mode: 'existing',
        host: 'redis.abc.cache.amazonaws.com',
        port: 6379,
        tls: true,
        securityGroupId: 'sg-0e0e0e0e0e0e0e0e0',
      },
      domain: {
        mode: 'route53',
        zoneId: 'Z123',
        zoneName: 'example.com',
        recordName: 'cartero.example.com',
        certificateArn: 'arn:aws:acm:eu-west-1:123456789012:certificate/abc',
      },
      allowExistingSgIngress: true,
      cloudfrontPrefixListId: undefined,
    }),
  )

  it('las descripciones de los grupos de seguridad son aceptables para EC2', () =>
    expectAwsSafeSgDescriptions(t))

  it('no crea lo que ya existe', () => {
    t.resourceCountIs('AWS::EC2::VPC', 0)
    t.resourceCountIs('AWS::RDS::DBInstance', 0)
    t.resourceCountIs('AWS::ElastiCache::ReplicationGroup', 0)
    t.resourceCountIs('AWS::CertificateManager::Certificate', 0)
    t.resourceCountIs('AWS::CloudFront::Distribution', 0)
  })

  it('abre los grupos de seguridad existentes solo a Cartero', () => {
    t.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      GroupId: 'sg-0d0d0d0d0d0d0d0d0',
      FromPort: 5432,
    })
    t.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      GroupId: 'sg-0e0e0e0e0e0e0e0e0',
      FromPort: 6379,
    })
  })

  it('sirve HTTPS con el certificado y el dominio, y redirige HTTP', () => {
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      Certificates: [{ CertificateArn: 'arn:aws:acm:eu-west-1:123456789012:certificate/abc' }],
    })
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      DefaultActions: [Match.objectLike({ Type: 'redirect' })],
    })
    t.hasResourceProperties('AWS::Route53::RecordSet', { Name: 'cartero.example.com.', Type: 'A' })
    expect(taskEnv(t)).toMatchObject({
      PUBLIC_URL: 'https://cartero.example.com',
      REDIS_TLS: 'true',
      DB_HOST: EXISTING_DB.host,
    })
  })
})

describe('EC2 con todo dentro (sslip.io)', () => {
  const t = synth(base({ compute: 'ec2', database: { mode: 'container' }, cache: { mode: 'container' } }))

  it('las descripciones de los grupos de seguridad son aceptables para EC2', () =>
    expectAwsSafeSgDescriptions(t))

  it('una máquina con IP fija y nada más que cueste', () => {
    t.resourceCountIs('AWS::EC2::Instance', 1)
    t.resourceCountIs('AWS::EC2::EIP', 1)
    t.resourceCountIs('AWS::RDS::DBInstance', 0)
    t.resourceCountIs('AWS::ElastiCache::ReplicationGroup', 0)
    t.resourceCountIs('AWS::EFS::FileSystem', 0)
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0)
    t.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't3.small',
      BlockDeviceMappings: [
        Match.objectLike({ Ebs: Match.objectLike({ VolumeType: 'gp3', Encrypted: true }) }),
      ],
    })
  })

  it('la configuración va en SSM y el user data monta Docker Compose y Caddy', () => {
    const json = JSON.stringify(t.toJSON())
    expect(json).toContain('/cartero/Cartero/config')
    expect(json).toContain('sslip.io')
    expect(json).toContain('docker-compose.yml')
    expect(json).toContain('reverse_proxy cartero:3000')
    expect(json).toContain('cartero-apply.service')
    // La contraseña de Postgres se genera en Secrets Manager y se conserva
    t.hasResource('AWS::SecretsManager::Secret', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({ Description: 'Contraseña de Postgres de Cartero' }),
    })
    expectNoPlainSecrets(t)
  })
})

describe('EC2 con RDS existente y dominio propio', () => {
  const t = synth(
    base({
      compute: 'ec2',
      network: EXISTING_NET,
      database: EXISTING_DB,
      cache: { mode: 'container' },
      domain: { mode: 'route53', zoneId: 'Z123', zoneName: 'example.com', recordName: 'cartero.example.com' },
      allowExistingSgIngress: true,
    }),
  )

  it('las descripciones de los grupos de seguridad son aceptables para EC2', () =>
    expectAwsSafeSgDescriptions(t))

  it('apunta el dominio a la IP y abre RDS a la máquina', () => {
    t.hasResourceProperties('AWS::Route53::RecordSet', { Name: 'cartero.example.com.', Type: 'A' })
    t.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      GroupId: 'sg-0d0d0d0d0d0d0d0d0',
      FromPort: 5432,
    })
    t.resourceCountIs('AWS::RDS::DBInstance', 0)
    // El rol de la máquina puede leer el secreto de RDS existente
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
            Resource: EXISTING_DB.secretArn,
          }),
        ]),
      },
    })
  })
})

describe('configuración', () => {
  it('no se puede guardar con secretos', () => {
    expect(() => assertNoSecrets({ database: { password: 'x' } })).toThrow(/secretos/)
    expect(() => assertNoSecrets({ creds: { secretAccessKey: 'x' } })).toThrow()
    expect(() => assertNoSecrets(base())).not.toThrow()
  })

  it('rechaza combinaciones sin sentido', () => {
    expect(validateConfig(base({ database: { mode: 'container' } }))).toContain(
      'En Fargate la base de datos y Redis no pueden ir en contenedores de la máquina',
    )
    expect(
      validateConfig(
        base({ network: { ...EXISTING_NET, publicSubnets: [EXISTING_NET.publicSubnets[0]] } }),
      ).join(),
    ).toMatch(/dos zonas/)
    expect(validateConfig(base({ database: EXISTING_DB })).join()).toMatch(/permiso/)
    expect(
      validateConfig(base({ admin: { emails: ['no-es-email'], allowRegistration: true } })).join(),
    ).toMatch(/Email/)
  })
})
