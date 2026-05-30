import { Hono } from 'hono'
import authRoute from './routes/auth'
import shareRoute from './routes/share'
import assetRoute from './routes/asset'

type Bindings = {
  R2: R2Bucket
  DB: D1Database
  MAILCHANNELS_FROM: string
  MAILCHANNELS_FROM_NAME: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => c.text('obsidian-share-hosted-worker: ok'))
app.route('/', authRoute)
app.route('/', shareRoute)
app.route('/', assetRoute)

export default app
