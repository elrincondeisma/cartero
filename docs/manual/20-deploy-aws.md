# Deploying to AWS

Cartero comes with a step-by-step wizard that deploys it to your AWS account with CDK. It asks only for credentials at the start. For each piece after that, you choose whether to reuse what you already have or let the wizard create it with its recommendations.

```bash
git clone https://github.com/elrincondeisma/cartero.git && cd cartero
pnpm install
pnpm deploy:aws
```

The wizard speaks English or Spanish, following your system language. Use `pnpm deploy:aws --lang en` to force English.

## What you need

- Node.js 22 and pnpm.
- An AWS account and a user or role that can create the resources: CloudFormation, IAM roles, VPC, ECS or EC2, RDS, ElastiCache, Secrets Manager and, without a domain, CloudFront. The `AdministratorAccess` policy covers everything.
- Docker is **not** needed: AWS pulls the public Cartero image from GHCR directly.

## The steps

1. **Credentials.** Pick a profile from `~/.aws` (SSO profiles included; if the session has expired, the wizard offers to run `aws sso login`), or paste an access key and secret. Pasted keys stay in memory and reach CDK as environment variables of the child process; they are never written to disk.
2. **Region.** It checks whether CDK is set up there (the `CDKToolkit` stack). If not, it runs `cdk bootstrap` before deploying.
3. **Mode.** *Recommended* creates everything. *Resource by resource* lets you reuse a VPC, a Postgres database, a Redis and a specific image.
4. **Compute:**
   - **ECS Fargate** (production): one task with 0.5 vCPU and 1 GB behind an Application Load Balancer, with uploaded files on EFS.
   - **EC2** (cheapest): a `t3.small` running Docker Compose with Caddy for automatic HTTPS, an Elastic IP and an encrypted 30 GB disk. You connect to it with SSM Session Manager; there is no SSH port.
5. **Network.**
   - **New (recommended):** a VPC in two zones with public and isolated subnets and no NAT gateway, which saves about $35 a month. The app gets a public IP, but its security group only accepts traffic from the load balancer (Fargate) or on ports 80 and 443 (EC2). RDS and Redis live in the isolated subnets.
   - **Existing:** the wizard lists your VPCs and sorts the subnets into public and private by their route tables. Fargate needs public subnets in two zones.
6. **Database.**
   - **New RDS Postgres 17** (`db.t4g.micro`, 20 GB gp3 encrypted, 7 days of backups). It keeps a final snapshot when destroyed.
   - **On the machine** (EC2 only): a Postgres container.
   - **Existing:** your RDS or Aurora Postgres instances and clusters in the chosen VPC. If RDS manages the password in Secrets Manager, that secret is used. Otherwise you type the user and password, and the wizard stores them in a new secret. The database must exist; Cartero creates the tables. The wizard asks before adding a rule to the database security group.
7. **Redis** (used for the monitor queue).
   - **New ElastiCache Valkey** (`cache.t4g.micro`).
   - **On the machine** (EC2 only).
   - **Existing:** your clusters, replication groups (not cluster mode) and serverless caches in the VPC.
8. **Domain.**
   - **Route 53 zone:** you pick a name such as `cartero.example.com`. With Fargate, the wizard looks for an ACM certificate that covers it, or creates one validated by DNS. With EC2, Caddy gets a Let's Encrypt certificate.
   - **No domain:** with Fargate, CloudFront sits in front of the load balancer and gives you `https://xxxx.cloudfront.net`, WebSocket included, and the load balancer only accepts CloudFront. With EC2, you get `https://<ip>.sslip.io` with Let's Encrypt.
9. **Administration.** The admin email (`ADMIN_EMAILS`) and whether anyone can sign up. Cartero uses the `stable` image, which updates from the app. In *Resource by resource* mode you can pin a version instead (`0.2.0`).
10. **Summary.** What is reused, what is created, the approximate monthly cost and what is kept if you destroy it. Nothing is created until you confirm.

When it finishes, it waits until `/api/health` answers and shows the address and the link to the setup wizard (`/setup`).

## Approximate cost

On-demand prices in us-east-1 / eu-west-1 with light traffic:

| Setup | Per month |
|---|---|
| Fargate + ALB + CloudFront + EFS + RDS + Valkey | ~$80 |
| Fargate reusing your RDS and Redis | ~$55 |
| EC2 with everything on the machine | ~$22 |

## Updating, status and destroying

**New versions of Cartero** are installed from Cartero itself: **Administration → System → Update**, or every night if you turn it on. On Fargate, Cartero asks ECS for a new deployment of its own service. On EC2, the `updater` container on the machine pulls the new image. See [Updating Cartero](21-updating.md).

To change the deployment itself, run `pnpm deploy:aws` again. If there are deployments in that account and region, the wizard offers:

- **Update.** It deploys again with the same configuration and the version you choose (`stable` or a fixed one), and brings in the latest image: on Fargate it asks ECS for a new deployment, and on EC2 it reapplies the configuration on the machine with SSM Run Command, without replacing it. Deployments made before versions existed, pinned by digest, move to `stable`.
- **Status.** The CloudFormation stack, its outputs and whether `/api/health` answers.
- **Destroy.** You type the stack name to confirm. On EC2 with Postgres on the machine, it offers to take a snapshot of the disk first.

What is **kept** on purpose when you destroy, so you don't lose data:

- the `CARTERO_SECRET_KEY` secret (without it, the secrets stored in the database cannot be decrypted);
- the final RDS snapshot;
- the EFS file system with the uploaded files;
- the Postgres password secret (EC2 with Postgres on the machine);
- everything that already existed: it is never deleted.

To delete all of that, look for the resources tagged `cartero:stack=<name>`.

## Without questions (CI)

The wizard saves each deployment, with no secrets, in `~/.config/cartero-aws/cartero-aws.<stack>.json` (`CARTERO_AWS_HOME` changes the folder). With that file you can deploy, check or destroy without the wizard, using the credentials from the environment or `--profile`:

```bash
node deploy/aws/dist/cli.js deploy  --config cartero-aws.Cartero.json
node deploy/aws/dist/cli.js status  --config cartero-aws.Cartero.json
node deploy/aws/dist/cli.js destroy --config cartero-aws.Cartero.json --yes
```

## Good to know

- **A single instance.** Cartero keeps presence and live run progress in memory, so it runs one task or one machine. Migrations run on start.
- **Secrets never sit in plain text.** Passwords live in Secrets Manager. On Fargate, the task builds `DATABASE_URL` and `REDIS_URL` when it starts. On EC2, `/opt/cartero/apply.sh` reads them with the instance role.
- **Logs.** On Fargate they go to CloudWatch (`aws logs tail <group> --follow`). On EC2, run `docker compose logs` in `/opt/cartero` (`aws ssm start-session --target <instance>`).
- **GuardDuty.** If your account has GuardDuty Runtime Monitoring, GuardDuty adds its agent to the Fargate task and creates its own VPC endpoint in the VPC. The task role can pull the agent from ECR. When you destroy, the wizard first removes that endpoint, but only in the VPC it created, so the VPC can be deleted.
- To change the stack itself, see [`deploy/aws`](../../deploy/aws/README.md).
