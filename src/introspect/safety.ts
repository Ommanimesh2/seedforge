import { createInterface } from 'node:readline'

const PRODUCTION_PATTERNS = [
  /\.rds\.amazonaws\.com$/i,
  /\.cloud\.google\.com$/i,
  /\.cloudsql\.google\.com$/i,
  /\.database\.azure\.com$/i,
  /\.supabase\.co$/i,
  /\.neon\.tech$/i,
  /\.render\.com$/i,
  /\.elephantsql\.com$/i,
  /\.aiven\.io$/i,
  /\.cockroachlabs\.cloud$/i,
  /\.digitalocean\.com$/i,
  /\.db\.ondigitalocean\.com$/i,
]

export function isProductionHost(hostname: string): boolean {
  return PRODUCTION_PATTERNS.some((pattern) => pattern.test(hostname))
}

export function extractHostFromConnectionString(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.hostname || null
  } catch {
    return null
  }
}

export async function confirmProductionAccess(
  hostname: string,
  skipPrompt: boolean,
): Promise<boolean> {
  const warning = `WARNING: "${hostname}" looks like a production database.`

  if (skipPrompt) {
    console.error(`${warning} Proceeding (--yes flag set).`)
    return true
  }

  if (!process.stdin.isTTY) {
    console.error(`${warning} Aborting (non-interactive mode). Use --yes to skip.`)
    return false
  }

  console.error(warning)

  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    rl.question('Continue? (yes/N) ', (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'yes')
    })
  })
}
