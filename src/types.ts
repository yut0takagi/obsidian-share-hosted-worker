export type ShareMode = 'org' | 'list' | 'public'

export interface NoteMeta {
  uuid: string
  owner_id: string
  mode: ShareMode
  audience: string[]
  org_domain: string
  expires_at: string | null
  created_at: string
  updated_at: string
  title: string
  source_path: string
  owner_email: string
}

export interface ShareRequest {
  uuid: string | null
  mode: ShareMode
  audience?: string[]
  org_domain?: string
  expires_at?: string | null
  title: string
  source_path: string
  html: string
  owner_email: string
}

export interface ShareResponse {
  uuid: string
  url: string
}

export interface User {
  id: string
  email: string
  created_at: string
  default_org_domain: string | null
  default_owner_name: string | null
}

export interface Session {
  token: string
  user_id: string
  created_at: string
  last_used_at: string | null
  name: string | null
}

export interface MagicLinkToken {
  token: string
  email: string
  callback: string
  created_at: string
  expires_at: string
  used_at: string | null
}
