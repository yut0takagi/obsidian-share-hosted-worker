import { Hono } from 'hono'

type Bindings = {}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => c.text('obsidian-share-hosted-worker: ok'))

export default app
