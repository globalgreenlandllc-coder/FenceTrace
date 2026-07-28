# FenceScan

FenceScan is the platform fence contractors run their business on. Type an
address and FenceScan pulls the satellite view and county property lines; you
confirm the fence, and a measured, priced, three-tier proposal is ready to send
in about a minute — with e-sign, scheduling, crew assignments, and payment
tracking built in.

## Development

```bash
npm install
npm run dev        # start the Next.js dev server
npm run typecheck  # tsc --noEmit
npm test           # node test runner over lib/**/*.test.mts
```

Database (Prisma + Postgres):

```bash
npm run db:migrate  # create/apply a migration locally
npm run db:deploy   # apply migrations (used by the build)
npm run db:studio   # browse data
```
