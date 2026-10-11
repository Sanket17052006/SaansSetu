# SaansSetu · School Air Action Network

**SaansSetu bridges AQI readings to school action.** Principals receive air-quality numbers, but often lack nearby and fresh context, a practical response for the school day, and a clear way to brief teachers and parents. SaansSetu shows the nearest public monitor with its distance and update time, helps school leaders plan a response, and prepares a principal-reviewed family message.

**One-line pitch:** *SaansSetu helps school leaders turn local air-quality context into a school-day plan and a clear update for families.*

The name joins *saans* (breath) and *setu* (bridge): a bridge from public AQI information to coordinated action by a school community.

The current website is a locally runnable product prototype. Its sample school readings are marked as demo data; the interface does not present them as live measurements. A school does not have an air monitor merely because a nearby CPCB station has one.

## Run the website

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Login and sign-up can be previewed without cloud credentials, but that mode is a local demo. To use real accounts, configure Amazon Cognito using the environment variables below. Do not put server-side credentials in `VITE_*` variables.

## Local data services

The backend is a separate FastAPI service. Docker Compose starts it with Redis and Kafka (KRaft mode):

```sh
cp .env.example .env
# Add your data.gov.in key to .env (keep this file private).
docker compose up --build
```

The web app calls the local API using `VITE_API_BASE_URL=http://127.0.0.1:8000`; set that in the root `.env` and restart Vite. When a data.gov.in key is present, the API begins an hourly background ingestion on startup. The first standards-eligible AQI can take up to 16 hours to appear because CPCB requires measurement coverage; before that, the interface should show unavailable data instead of a fabricated AQI. Manual ingestion is also available at `POST /api/aqi/ingest` with the `X-Ingest-Token` from `.env`. Each successful ingest publishes normalized observations to Kafka and stores the rolling series in Redis.

### Data and AQI rules

- Source: the Government of India's data.gov.in real-time air-quality resource, populated from monitoring stations. The key is sent only by the backend.
- The feed contains pollutant observations. `pollutant_avg` is a concentration, **not** an AQI value. SaansSetu calculates pollutant sub-indices using CPCB breakpoint tables and reports the maximum sub-index as the AQI.
- Calculation follows the CPCB AQI method: at least three available pollutants, including PM2.5 or PM10. Otherwise the API returns `unavailable` rather than inventing a number.
- Station distance and observation time are included. Station readings are contextual information for a school, not measurements at the school gate. Do not use an old or distant station as a current school reading.
- School actions are informational prompts, not medical advice or automated closure decisions. Follow current state/district orders and qualified health guidance.

## Product plan

### Who uses it

1. **Educator / staff** — joins an approved school, sees the current school air brief, action checklist and alert history.
2. **School administrator** — intended to verify school details, invite staff, choose notification channels and record a response (for example, moved PE indoors). The current local preview has a principal preview account; it is not a secure role-management service.
3. **District officer** — intended to be invite-only, view aggregated school status and alert acknowledgements across an assigned district. District officers should not browse student health data; SaansSetu does not need to collect it.

Public registration creates an educator account. An administrator request remains pending verification. District access is granted only by an authorized operator. The frontend role selector is not an authorization boundary; production APIs must validate Cognito tokens and enforce school/district membership server-side.

### What makes the product useful

- **School readiness brief:** current AQI category, dominant pollutant, source station, distance, timestamp and confidence/freshness state in one view.
- **School response log:** the local preview lets a staff member check off plan review, staff briefing and family update. It saves to that browser for the current day only; it is not yet a shared or audited school record.
- **Principal-to-family updates:** generate an editable, reading-aware message for parents, class groups, teachers, or all school groups. The principal reviews the wording and uses the device share sheet or copies it into the school’s existing channel. Educators can prepare a draft for principal review. SaansSetu does not auto-send, scrape group membership, or claim that a message was delivered.
- **Coverage confidence:** display the selected public monitor’s distance, observation time and whether it has enough data for a CPCB calculation. A missing reading does not mean clean air.
- **District pulse:** planned for verified district accounts; the current four-school network is sample data, not a live school registry.
- **Plain-language alerts:** explain the reading and link to the source/method. Alerts avoid claiming that the station is on campus.

## Architecture

### Local prototype

`React + Vite → FastAPI → data.gov.in`, with **Redis** holding the 24-hour station history and **Kafka** receiving normalized station events. The API runs its hourly ingestion loop when configured. Sample readings remain clearly labeled when the source is not configured. Redis and Kafka are local development dependencies; the project does not yet have a Kafka consumer, hosted AWS deployment, or production authentication and authorization.

### AWS integration path (not deployed)

The event’s prize eligibility requires either an AWS open-source tool or an AWS deployment. The current local Redis/Kafka setup alone does not meet that requirement. Use **AWS SAM CLI** for the serverless build and deployment; this is on the event’s AWS open-source list. A compact implementation is:

`Cognito → API Gateway JWT authorizer → Lambda API → DynamoDB`

`EventBridge Scheduler → ingestion Lambda → Secrets Manager (data.gov.in key) → S3 latest snapshot + DynamoDB hourly history`

`Lambda → SES (verified school sender) or a specifically authorized Telegram test bot`

- **Cognito** for signup, verified email, password recovery and token issuance. Map Cognito groups to Educator, SchoolAdmin and DistrictOfficer; enforce membership and assigned-district checks in every protected API.
- **Cognito** issues verified identity tokens. New accounts get Educator by default; district officers are operator-invited, and school administrator access waits for school verification.
- **API Gateway JWT authorizer** validates tokens; Lambda checks the user’s school or district membership for every private operation. A browser-selected role is never authorization.
- **DynamoDB** stores school membership, subscriptions, action acknowledgements and delivery audit records. **S3** stores the latest public station snapshot.
- **EventBridge Scheduler + Lambda** fetch the government station feed hourly. **Secrets Manager** stores the data.gov.in key. Add SQS dead-letter handling and CloudWatch alarms for ingestion failures and stale data.
- **SES** is the easiest AWS-native email path after sender identity verification. Telegram stays disabled until the bot and exact private test destinations are supplied and approved. The current UI supports review/copy/device sharing only; it does not claim delivery.
- **Amplify Hosting** can deploy the Vite client. Add CloudFront/S3 only if needed for a custom hosting setup.
- Keep local Redis and Kafka for development and the event demo, but don’t provision ElastiCache or MSK for the first AWS version. They add operational and cost overhead before there is a demonstrated need.
- **Privacy:** no student names, diagnoses, or individual health histories. Store only the minimum school/staff operational data, define deletion/retention, and obtain school consent before onboarding real institutions.
- **Family communications:** real delivery would need a school-approved channel (for example, an opted-in email/SMS provider or an approved WhatsApp Business integration), verified sender identity, guardian consent and opt-out handling, delivery receipts, rate limits, and a principal audit record. Never add families to groups or send to personal numbers without authorization.

### Rollout order

1. Local prototype: verified source adapter, CPCB AQI calculation, freshness/coverage display, local auth preview, principal-reviewed family message drafts and action loop.
2. Small pilot: one district, a few consenting schools, Cognito, authenticated API, audit trail and email alerts; manually review readings and actions.
3. Reliability: scheduled ingestion, retries/dead-letter handling, freshness alarms, source outage banner, backup and deletion procedures.
4. Scale only when pilot usage justifies managed streaming/cache services and an approved AWS budget.

## Setup checklist

### You need

- **data.gov.in:** create an account and generate an API key in your profile. Put it in the private root `.env` as `DATA_GOV_IN_API_KEY`; never prefix it with `VITE_`, commit it, or paste it into chat. The source resource ID is configured in the backend.
- **School search:** the dropdown searches OpenStreetMap’s Photon service for school-tagged place listings. Coverage varies; listings are not proof that a school or its coordinates are verified.
- **AWS account:** needed only for cloud deployment. Enable MFA, set a low billing budget/alarm first, and use AWS CLI v2 with IAM Identity Center (`aws configure sso`) rather than long-lived access keys.
- **AWS SAM CLI + Docker:** required for the recommended AWS serverless build/deployment workflow. The local website/backend do not need an AWS account.
- **Cognito:** after the AWS stack exists, use its output values for `VITE_AWS_REGION`, `VITE_COGNITO_USER_POOL_ID`, and `VITE_COGNITO_CLIENT_ID`. The client ID is public configuration; user-pool secrets and data.gov.in key are not.
- **Telegram (optional):** create a bot through Telegram’s official BotFather, add it to private test groups, and give the backend the bot token plus the chat IDs for those exact groups. Put these only in AWS Secrets Manager or a private backend `.env`; never in Vite variables or this chat. Do not use parent groups until the school has approved the bot, destination and message workflow.
- **Email alternative:** provide a school-controlled sender address/domain and verify it in Amazon SES. SES accounts may start in a sandbox, where recipient addresses must also be verified.
- **Hackathon:** confirm team/account eligibility and register the project in the official event portal before submission.

For local login preview, leave Cognito variables empty. No AWS resource has been created by this project setup. Do not create MSK or ElastiCache clusters for the demo without first checking the current pricing and agreeing on a budget.

## Environment variables

See `.env.example`. Root `.env` is private and ignored by Git. Frontend variables are bundled into browser code and must contain public configuration only.

## Useful references

- [data.gov.in real-time AQI catalog](https://www.data.gov.in/catalog/real-time-air-quality-index)
- [CPCB AQI method report](https://app.cpcbccr.com/ccr_docs/FINAL-REPORT_AQI_.pdf)
- [CPCB National AQI concentration breakpoints](https://cpcb.nic.in/upload/NAAQS_2019.pdf)
- [WeMakeDevs Environmental Hacks AWS track requirements](https://www.wemakedevs.org/aws/env)
- [Photon search API](https://github.com/komoot/photon/blob/master/docs/api-v1.md)
- [AWS Cognito with API Gateway](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-accessing-resources-api-gateway-and-lambda.html)
- [Amazon MSK pricing](https://aws.amazon.com/msk/pricing/)
- [Amazon ElastiCache pricing](https://aws.amazon.com/elasticache/pricing/)

## Build

```sh
npm run build
```
