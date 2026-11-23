/**
 * Stack de Cartero en AWS. Todo sale del DeployConfig que decide el asistente:
 * - Fargate: ALB (+ CloudFront si no hay dominio), una tarea, EFS para los ficheros;
 * - EC2: una máquina con Docker Compose y Caddy (HTTPS automático), configurada desde SSM.
 * Lo que ya existía (VPC, RDS, Redis, zona, certificado) se importa y nunca se borra.
 */
import {
  aws_certificatemanager as acm,
  CfnOutput,
  aws_cloudfront as cloudfront,
  Duration,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_efs as efs,
  aws_elasticache as elasticache,
  aws_elasticloadbalancingv2 as elbv2,
  Fn,
  aws_iam as iam,
  aws_logs as logs,
  aws_cloudfront_origins as origins,
  aws_ecs_patterns as patterns,
  RemovalPolicy,
  aws_rds as rds,
  aws_route53 as route53,
  Stack,
  type StackProps,
  aws_secretsmanager as secretsmanager,
  aws_ssm as ssm,
  Tags,
} from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import { type DeployConfig, imageChannel } from '../config.js'
import { ec2UserData } from './ec2-files.js'

/** Usuario de la imagen (node): dueño de la carpeta de ficheros en EFS. */
const NODE_UID = '1000'

/**
 * Arranque de la tarea: compone DATABASE_URL y REDIS_URL con las piezas que llegan de Secrets
 * Manager (codificando la contraseña) y arranca el servidor. Así la contraseña no está nunca
 * en la plantilla ni en la definición de la tarea.
 */
export const TASK_BOOTSTRAP = [
  'const e=process.env,u=encodeURIComponent;',
  "if(!e.DATABASE_URL)e.DATABASE_URL='postgres://'+u(e.DB_USER)+':'+u(e.DB_PASS)+'@'+e.DB_HOST+':'+e.DB_PORT+'/'+e.DB_NAME+(e.DB_SSL==='true'?'?sslmode=require':'');",
  "if(!e.REDIS_URL)e.REDIS_URL=(e.REDIS_TLS==='true'?'rediss':'redis')+'://'+(e.REDIS_PASS?':'+u(e.REDIS_PASS)+'@':'')+e.REDIS_HOST+':'+e.REDIS_PORT;",
  "await import('/app/dist/index.js')",
].join('')

export interface CarteroStackProps extends StackProps {
  config: DeployConfig
}

export class CarteroStack extends Stack {
  /** Zonas elegidas por el asistente: con ellas CDK no busca nada en la cuenta al sintetizar */
  private azs?: string[]

  override get availabilityZones(): string[] {
    return this.azs ?? super.availabilityZones
  }

  constructor(scope: Construct, id: string, props: CarteroStackProps) {
    super(scope, id, props)
    const c = props.config
    if (c.network.mode === 'new' && c.network.azs?.length) this.azs = c.network.azs
    Tags.of(this).add('app', 'cartero')
    Tags.of(this).add('cartero:stack', c.stackName)

    // ───────── Red ─────────
    let vpc: ec2.IVpc
    let publicSubnets: ec2.SubnetSelection
    let dataSubnets: ec2.SubnetSelection
    if (c.network.mode === 'new') {
      // Sin NAT (≈ 35 $/mes menos): lo que sale a Internet va en subredes públicas protegido por
      // grupos de seguridad; RDS y Redis, en subredes aisladas.
      vpc = new ec2.Vpc(this, 'Vpc', {
        ...(c.network.azs?.length ? { availabilityZones: c.network.azs } : { maxAzs: 2 }),
        natGateways: 0,
        subnetConfiguration: [
          { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
          { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        ],
      })
      publicSubnets = { subnetType: ec2.SubnetType.PUBLIC }
      dataSubnets = { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }
    } else {
      const net = c.network
      const azs = [...new Set([...net.publicSubnets, ...net.privateSubnets].map((s) => s.az))]
      vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', { vpcId: net.vpcId, availabilityZones: azs })
      const sub = (prefix: string, s: { id: string; az: string }) =>
        ec2.Subnet.fromSubnetAttributes(this, `${prefix}${s.id}`, { subnetId: s.id, availabilityZone: s.az })
      publicSubnets = { subnets: net.publicSubnets.map((s) => sub('Pub', s)) }
      const data = net.privateSubnets.length ? net.privateSubnets : net.publicSubnets
      dataSubnets = { subnets: data.map((s) => sub('Data', s)) }
    }

    // Grupo de seguridad de Cartero (la tarea o la EC2): a él se abren la base de datos y Redis
    const appSg = new ec2.SecurityGroup(this, 'AppSg', {
      vpc,
      description: 'Cartero',
      allowAllOutbound: true,
    })

    // ───────── Secretos ─────────
    // Clave con la que Cartero cifra secretos en la base de datos: si se pierde, no se pueden descifrar
    const secretKey = new secretsmanager.Secret(this, 'SecretKey', {
      description: `CARTERO_SECRET_KEY de ${c.stackName}`,
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: RemovalPolicy.RETAIN,
    })

    // ───────── Base de datos ─────────
    let dbSecret: secretsmanager.ISecret
    let dbHost = 'postgres'
    let dbPort = '5432'
    let dbName = 'cartero'
    let dbSsl = false
    if (c.database.mode === 'new') {
      const db = new rds.DatabaseInstance(this, 'Database', {
        engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
        vpc,
        vpcSubnets: dataSubnets,
        credentials: rds.Credentials.fromGeneratedSecret('cartero'),
        databaseName: 'cartero',
        allocatedStorage: 20,
        maxAllocatedStorage: 100,
        storageType: rds.StorageType.GP3,
        storageEncrypted: true,
        backupRetention: Duration.days(7),
        removalPolicy: RemovalPolicy.SNAPSHOT,
        deletionProtection: false,
      })
      db.connections.allowDefaultPortFrom(appSg, 'Cartero')
      if (!db.secret) throw new Error('RDS sin secreto generado')
      dbSecret = db.secret
      dbHost = db.instanceEndpoint.hostname
      dbPort = String(db.instanceEndpoint.port)
      dbSsl = true
    } else if (c.database.mode === 'existing') {
      const d = c.database
      dbSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'DatabaseSecret', d.secretArn)
      dbHost = d.host
      dbPort = String(d.port)
      dbName = d.name
      dbSsl = d.ssl
      if (d.securityGroupId)
        ec2.SecurityGroup.fromSecurityGroupId(this, 'ExistingDbSg', d.securityGroupId, {
          mutable: true,
        }).addIngressRule(appSg, ec2.Port.tcp(d.port), `Cartero (${c.stackName})`)
    } else {
      // Postgres en un contenedor de la EC2: su contraseña también va en Secrets Manager
      dbSecret = new secretsmanager.Secret(this, 'ContainerDbPassword', {
        description: `Contraseña de Postgres de ${c.stackName}`,
        generateSecretString: { passwordLength: 32, excludePunctuation: true },
        removalPolicy: RemovalPolicy.RETAIN,
      })
    }

    // ───────── Redis (cola de monitores) ─────────
    let redisHost = 'redis'
    let redisPort = '6379'
    let redisTls = false
    let redisSecret: secretsmanager.ISecret | undefined
    if (c.cache.mode === 'new') {
      const cacheSg = new ec2.SecurityGroup(this, 'CacheSg', {
        vpc,
        description: 'Redis de Cartero',
        allowAllOutbound: false,
      })
      cacheSg.addIngressRule(appSg, ec2.Port.tcp(6379), 'Cartero')
      const subnetIds = vpc.selectSubnets(dataSubnets).subnetIds
      const group = new elasticache.CfnSubnetGroup(this, 'CacheSubnets', {
        description: 'Cartero',
        subnetIds,
      })
      // Valkey solo se puede crear como grupo de replicación (aquí, de un solo nodo)
      const cache = new elasticache.CfnReplicationGroup(this, 'Cache', {
        replicationGroupDescription: `Cartero ${c.stackName}`,
        engine: 'valkey',
        engineVersion: '8.0',
        cacheNodeType: 'cache.t4g.micro',
        numCacheClusters: 1,
        automaticFailoverEnabled: false,
        atRestEncryptionEnabled: true,
        transitEncryptionEnabled: true,
        cacheSubnetGroupName: group.ref,
        securityGroupIds: [cacheSg.securityGroupId],
      })
      redisHost = cache.attrPrimaryEndPointAddress
      redisPort = cache.attrPrimaryEndPointPort
      redisTls = true
    } else if (c.cache.mode === 'existing') {
      const r = c.cache
      redisHost = r.host
      redisPort = String(r.port)
      redisTls = r.tls
      if (r.authSecretArn)
        redisSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'RedisSecret', r.authSecretArn)
      if (r.securityGroupId)
        ec2.SecurityGroup.fromSecurityGroupId(this, 'ExistingCacheSg', r.securityGroupId, {
          mutable: true,
        }).addIngressRule(appSg, ec2.Port.tcp(r.port), `Cartero (${c.stackName})`)
    }

    // ───────── Dominio ─────────
    const zone =
      c.domain.mode === 'route53'
        ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
            hostedZoneId: c.domain.zoneId,
            zoneName: c.domain.zoneName,
          })
        : undefined

    const common = {
      ADMIN_EMAILS: c.admin.emails.join(','),
      ALLOW_REGISTRATION: String(c.admin.allowRegistration),
    }

    if (c.compute === 'fargate') {
      this.fargate(c, {
        vpc,
        publicSubnets,
        dataSubnets,
        appSg,
        secretKey,
        dbSecret,
        redisSecret,
        zone,
        env: {
          ...common,
          DB_HOST: dbHost,
          DB_PORT: dbPort,
          DB_NAME: dbName,
          DB_SSL: String(dbSsl),
          REDIS_HOST: redisHost,
          REDIS_PORT: redisPort,
          REDIS_TLS: String(redisTls),
        },
      })
    } else {
      this.ec2(c, {
        vpc,
        publicSubnets,
        appSg,
        secretKey,
        dbSecret,
        redisSecret,
        zone,
        common,
        db: { host: dbHost, port: dbPort, name: dbName, ssl: dbSsl },
        cache: { host: redisHost, port: redisPort, tls: redisTls },
      })
    }

    new CfnOutput(this, 'SecretKeyArn', {
      value: secretKey.secretArn,
      description:
        'CARTERO_SECRET_KEY: guárdala, sin ella no se pueden descifrar los secretos de la base de datos',
    })
  }

  // ───────────────────────────── Fargate ─────────────────────────────
  private fargate(
    c: DeployConfig,
    p: {
      vpc: ec2.IVpc
      publicSubnets: ec2.SubnetSelection
      dataSubnets: ec2.SubnetSelection
      appSg: ec2.SecurityGroup
      secretKey: secretsmanager.ISecret
      dbSecret: secretsmanager.ISecret
      redisSecret?: secretsmanager.ISecret
      zone?: route53.IHostedZone
      /** Variables de la tarea (sin secretos): admins, registro, piezas de DATABASE_URL y REDIS_URL */
      env: Record<string, string>
    },
  ) {
    const withCloudFront = c.domain.mode === 'none'

    // Balanceador: con CloudFront solo acepta tráfico de CloudFront; con dominio, HTTPS público
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: p.vpc,
      description: 'ALB de Cartero',
      allowAllOutbound: true,
    })
    if (withCloudFront) {
      albSg.addIngressRule(
        c.cloudfrontPrefixListId ? ec2.Peer.prefixList(c.cloudfrontPrefixListId) : ec2.Peer.anyIpv4(),
        ec2.Port.tcp(80),
        'CloudFront',
      )
    } else {
      albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS')
      albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP to HTTPS')
    }
    p.appSg.addIngressRule(albSg, ec2.Port.tcp(3000), 'ALB')
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: p.vpc,
      internetFacing: true,
      vpcSubnets: p.publicSubnets,
      securityGroup: albSg,
      // El WebSocket hace ping cada 25 s; el SSE del runner puede estar callado un rato
      idleTimeout: Duration.seconds(120),
    })

    let publicUrl: string
    let distribution: cloudfront.Distribution | undefined
    if (withCloudFront) {
      distribution = new cloudfront.Distribution(this, 'Cdn', {
        comment: `Cartero (${c.stackName})`,
        defaultBehavior: {
          origin: new origins.HttpOrigin(alb.loadBalancerDnsName, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            readTimeout: Duration.seconds(60),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Incluye CloudFront-Forwarded-Proto: el ALB pone X-Forwarded-Proto=http y Cartero debe saber que es https
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_AND_CLOUDFRONT_2022,
        },
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      })
      publicUrl = `https://${distribution.distributionDomainName}`
    } else {
      publicUrl = `https://${(c.domain as { recordName: string }).recordName}`
    }

    // Ficheros subidos (form-data): EFS cifrado, carpeta propia del usuario node
    const files = new efs.FileSystem(this, 'Files', {
      vpc: p.vpc,
      vpcSubnets: p.dataSubnets,
      encrypted: true,
      removalPolicy: RemovalPolicy.RETAIN,
    })
    const accessPoint = files.addAccessPoint('FilesAp', {
      path: '/cartero-files',
      posixUser: { uid: NODE_UID, gid: NODE_UID },
      createAcl: { ownerUid: NODE_UID, ownerGid: NODE_UID, permissions: '750' },
    })
    files.connections.allowDefaultPortFrom(p.appSg, 'Cartero')

    const channel = imageChannel(c.image)
    const task = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    })
    // Permisos de ECR: si la cuenta tiene GuardDuty Runtime Monitoring, ECS añade a la tarea su
    // agente, que se descarga de ECR con este rol (la imagen de Cartero viene de GHCR y no los pide)
    task
      .obtainExecutionRole()
      .addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      )
    task.addVolume({
      name: 'files',
      efsVolumeConfiguration: {
        fileSystemId: files.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: { accessPointId: accessPoint.accessPointId, iam: 'ENABLED' },
      },
    })
    files.grant(task.taskRole, 'elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite')

    const secrets: Record<string, ecs.Secret> = {
      CARTERO_SECRET_KEY: ecs.Secret.fromSecretsManager(p.secretKey),
      DB_USER: ecs.Secret.fromSecretsManager(p.dbSecret, 'username'),
      DB_PASS: ecs.Secret.fromSecretsManager(p.dbSecret, 'password'),
    }
    if (p.redisSecret) secrets.REDIS_PASS = ecs.Secret.fromSecretsManager(p.redisSecret, 'password')

    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    })
    const container = task.addContainer('cartero', {
      image: ecs.ContainerImage.fromRegistry(c.image),
      entryPoint: ['/sbin/tini', '--'],
      command: ['node', '--input-type=module', '-e', TASK_BOOTSTRAP],
      portMappings: [{ containerPort: 3000 }],
      environment: {
        ...p.env,
        PUBLIC_URL: publicUrl,
        FILES_DIR: '/data/files',
        NODE_ENV: 'production',
        // Con :stable, la app se actualiza pidiendo a ECS un despliegue nuevo de su propio servicio
        CARTERO_CHANNEL: channel,
        CARTERO_DEPLOY: 'aws-fargate',
        ...(channel === 'stable' ? { CARTERO_UPDATER: 'ecs' } : {}),
      },
      secrets,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'cartero', logGroup }),
    })
    container.addMountPoints({ sourceVolume: 'files', containerPath: '/data/files', readOnly: false })

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc: p.vpc })
    if (channel === 'stable') {
      // Solo sobre el cluster de este stack: encontrar su servicio y redesplegarlo
      const arn = (kind: string) =>
        Stack.of(this).formatArn({ service: 'ecs', resource: kind, resourceName: `${cluster.clusterName}/*` })
      task.addToTaskRolePolicy(
        new iam.PolicyStatement({
          actions: ['ecs:DescribeServices', 'ecs:UpdateService'],
          resources: [arn('service')],
        }),
      )
      task.addToTaskRolePolicy(
        new iam.PolicyStatement({ actions: ['ecs:DescribeTasks'], resources: [arn('task')] }),
      )
    }
    const certificate =
      c.domain.mode === 'route53'
        ? c.domain.certificateArn
          ? acm.Certificate.fromCertificateArn(this, 'Certificate', c.domain.certificateArn)
          : new acm.Certificate(this, 'Certificate', {
              domainName: c.domain.recordName,
              validation: acm.CertificateValidation.fromDns(p.zone),
            })
        : undefined

    const service = new patterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      taskDefinition: task,
      // Una sola tarea: la presencia en tiempo real y el progreso del runner viven en memoria
      desiredCount: 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      loadBalancer: alb,
      openListener: false,
      assignPublicIp: true,
      taskSubnets: p.publicSubnets,
      securityGroups: [p.appSg],
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: Duration.seconds(120),
      ...(certificate
        ? {
            protocol: elbv2.ApplicationProtocol.HTTPS,
            certificate,
            domainName: (c.domain as { recordName: string }).recordName,
            domainZone: p.zone,
            redirectHTTP: true,
          }
        : { protocol: elbv2.ApplicationProtocol.HTTP, listenerPort: 80 }),
    })
    service.targetGroup.configureHealthCheck({
      path: '/api/health',
      healthyHttpCodes: '200',
      interval: Duration.seconds(15),
    })
    service.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '15')

    new CfnOutput(this, 'Url', { value: publicUrl, description: 'Dirección de Cartero' })
    new CfnOutput(this, 'SetupUrl', {
      value: `${publicUrl}/setup`,
      description: 'Asistente de instalación (la primera vez)',
    })
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName })
    new CfnOutput(this, 'ServiceName', { value: service.service.serviceName })
    new CfnOutput(this, 'LogGroupName', { value: logGroup.logGroupName })
    if (distribution) new CfnOutput(this, 'DistributionId', { value: distribution.distributionId })
  }

  // ───────────────────────────── EC2 ─────────────────────────────
  private ec2(
    c: DeployConfig,
    p: {
      vpc: ec2.IVpc
      publicSubnets: ec2.SubnetSelection
      appSg: ec2.SecurityGroup
      secretKey: secretsmanager.ISecret
      dbSecret: secretsmanager.ISecret
      redisSecret?: secretsmanager.ISecret
      zone?: route53.IHostedZone
      common: Record<string, string>
      db: { host: string; port: string; name: string; ssl: boolean }
      cache: { host: string; port: string; tls: boolean }
    },
  ) {
    p.appSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP (Lets Encrypt and redirect)')
    p.appSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS')
    p.appSg.addIngressRule(ec2.Peer.anyIpv6(), ec2.Port.tcp(80), 'HTTP')
    p.appSg.addIngressRule(ec2.Peer.anyIpv6(), ec2.Port.tcp(443), 'HTTPS')

    const eip = new ec2.CfnEIP(this, 'Ip', { tags: [{ key: 'Name', value: `cartero-${c.stackName}` }] })
    const site =
      c.domain.mode === 'route53'
        ? c.domain.recordName
        : Fn.join('', [Fn.join('-', Fn.split('.', eip.ref)), '.sslip.io'])

    // Lo que puede cambiar (imagen, URL, admins…) va en SSM: la máquina lo aplica sin reemplazarse
    const paramName = `/cartero/${c.stackName}/config`
    const param = new ssm.StringParameter(this, 'Config', {
      parameterName: paramName,
      description: 'Configuración de Cartero (la aplica /opt/cartero/apply.sh)',
      stringValue: this.toJsonString({
        image: c.image,
        site,
        publicUrl: Fn.join('', ['https://', site]),
        adminEmails: p.common.ADMIN_EMAILS,
        allowRegistration: p.common.ALLOW_REGISTRATION,
        db: { mode: c.database.mode, host: p.db.host, port: p.db.port, name: p.db.name, ssl: p.db.ssl },
        cache: { mode: c.cache.mode, host: p.cache.host, port: p.cache.port, tls: p.cache.tls },
        secrets: {
          key: p.secretKey.secretArn,
          db: p.dbSecret.secretArn,
          redis: p.redisSecret?.secretArn ?? '',
        },
      }),
    })

    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    })
    param.grantRead(role)
    p.secretKey.grantRead(role)
    p.dbSecret.grantRead(role)
    p.redisSecret?.grantRead(role)

    const instance = new ec2.Instance(this, 'Instance', {
      vpc: p.vpc,
      vpcSubnets: p.publicSubnets,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.X86_64 }),
      securityGroup: p.appSg,
      role,
      // En subredes importadas no se sabe si son públicas: la IP llega con la EIP (el arranque la espera)
      ...(c.network.mode === 'new' ? { associatePublicIpAddress: true } : {}),
      requireImdsv2: true,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(30, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true }),
        },
      ],
      userData: ec2UserData(this.region, paramName),
      // La máquina no se reemplaza al cambiar la configuración: la aplica apply.sh
      userDataCausesReplacement: false,
    })
    instance.node.addDependency(param)
    new ec2.CfnEIPAssociation(this, 'IpAssociation', {
      allocationId: eip.attrAllocationId,
      instanceId: instance.instanceId,
    })

    if (c.domain.mode === 'route53' && p.zone) {
      new route53.ARecord(this, 'Record', {
        zone: p.zone,
        recordName: c.domain.recordName,
        target: route53.RecordTarget.fromIpAddresses(eip.ref),
        ttl: Duration.minutes(5),
      })
    }

    new CfnOutput(this, 'Url', {
      value: Fn.join('', ['https://', site]),
      description: 'Dirección de Cartero',
    })
    new CfnOutput(this, 'SetupUrl', { value: Fn.join('', ['https://', site, '/setup']) })
    new CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      description: 'Conéctate con: aws ssm start-session --target <id>',
    })
    new CfnOutput(this, 'PublicIp', { value: eip.ref })
    new CfnOutput(this, 'ConfigParameter', { value: paramName })
  }
}
