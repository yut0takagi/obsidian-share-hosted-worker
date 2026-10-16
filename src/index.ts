import { Hono } from 'hono'
import authRoute from './routes/auth'
import shareRoute from './routes/share'
import assetRoute from './routes/asset'
import noteRoute from './routes/note'
import publicRoute from './routes/public'

type Bindings = {
  R2: R2Bucket
  DB: D1Database
  RESEND_API_KEY?: string
  MAIL_FROM?: string
  MAIL_FROM_NAME?: string
  CF_ACCESS_TEAM_DOMAIN: string
  CF_ACCESS_AUD: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => c.text('obsidian-share-hosted-worker: ok'))
app.route('/', authRoute)
app.route('/', shareRoute)
app.route('/', assetRoute)
app.route('/', noteRoute)
app.route('/', publicRoute)

export default app
