# @cartero/deploy-aws

A wizard that deploys Cartero to AWS with CDK. How to use it is in the manual: [Deploying to AWS](../../docs/manual/20-deploy-aws.md). This page is for anyone who wants to change it.

[Español](README.es.md)

```
src/cli.ts            entry point: wizard, or deploy/status/destroy with --config
src/i18n.ts           texts in Spanish and English (same keys; a test checks it)
src/wizard/           the steps: credentials and region, build (compute, network, database,
                      Redis, domain, admin), summary, manage (update, status, destroy)
src/aws/              session (profiles, keys, env for cdk) and discover (read-only lookups)
src/config.ts         DeployConfig: what the wizard decides; saved without secrets
src/cost.ts           approximate monthly cost
src/deploy.ts         runs the package's own cdk CLI, waits for /api/health, SSM, snapshots
src/app.ts            CDK app: reads the DeployConfig (-c config=… or CARTERO_AWS_CONFIG)
src/stack/            CarteroStack (Fargate or EC2) and the files the EC2 instance writes
test/                 templates for the four combinations and the wizard logic
```

## Working on it

```bash
pnpm --filter @cartero/deploy-aws test        # vitest: templates + wizard logic
pnpm --filter @cartero/deploy-aws typecheck
pnpm --filter @cartero/deploy-aws build
cd deploy/aws && npx cdk synth -c config=/path/to/cartero-aws.<stack>.json
```

`cdk synth` doesn't need credentials when the config has everything (the wizard stores the availability zones of a new VPC, and existing resources are imported by ID), so the stack never depends on context lookups.

## Rules the stack follows

- **No secret in the template or the config file.** Fargate receives `DB_USER`, `DB_PASS` and `REDIS_PASS` from Secrets Manager and builds the URLs when the task starts (`TASK_BOOTSTRAP`). EC2 reads them with its role in `apply.sh`. The tests check it.
- **One instance.** Presence and live runner progress are in memory: `desiredCount: 1` and, on EC2, a single machine.
- **Nothing that already existed is deleted.** Existing resources are imported by attributes. Rules added to their security groups disappear with the stack.
- **Data survives `destroy`.** `CARTERO_SECRET_KEY`, the RDS snapshot, EFS and the container database password are retained.
- **The EC2 user data never changes between deployments**, so the machine is never replaced. The configuration lives in the SSM parameter `/cartero/<stack>/config`, and `apply.sh` applies it on boot and when you update.
- **The image is `:stable` and updates from the app.** On Fargate, the task role can only call `ecs:DescribeTasks`, `ecs:DescribeServices` and `ecs:UpdateService` on the stack's cluster, to redeploy its own service. On EC2, the `updater` container (the same [`docker/updater.sh`](../../docker/updater.sh) as in Docker Compose) recreates Cartero. With a fixed version (`:0.2.0`) there are no permissions and no button. The tests check it.
