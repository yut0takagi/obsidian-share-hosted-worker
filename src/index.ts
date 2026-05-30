import { Hono } from 'hono'
import authRoute from './routes/auth'

type Bindings = {
  R2: R2Bucket
  DB: D1Database
  MAILCHANNELS_FROM: string
  MAILCHANNELS_FROM_NAME: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => c.text('obsidian-share-hosted-worker: ok'))
app.route('/', authRoute)

export default app
