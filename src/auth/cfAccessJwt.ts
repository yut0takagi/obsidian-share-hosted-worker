// src/auth/cfAccessJwt.ts
import { jwtVerify, createRemoteJWKSet } from 'jose'

export interface AccessClaims {
  email: string
  sub: string
  aud: string | string[]
  iss: string
  exp: number
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(teamDomain: string) {
  if (jwksCache.has(teamDomain)) return jwksCache.get(teamDomain)!
  const jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))
  jwksCache.set(teamDomain, jwks)
  return jwks
}

export async function verifyAccessJwt(jwt: string, teamDomain: string, aud: string): Promise<AccessClaims | null> {
  if (!jwt || jwt.split('.').length !== 3) return null
  try {
    const jwks = getJwks(teamDomain)
    const { payload } = await jwtVerify(jwt, jwks, {
      issuer: `https://${teamDomain}`,
      audience: aud,
    })
    return payload as unknown as AccessClaims
  } catch (e) {
    console.error('[share-hosted] JWT verify failed:', e)
    return null
  }
}
