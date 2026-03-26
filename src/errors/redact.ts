export function redactConnectionString(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.password) {
      parsed.password = '***'
    }
    return parsed.toString()
  } catch {
    // If URL parsing fails, try regex-based redaction
    return url.replace(
      /(:\/\/[^:]+):([^@]+)@/,
      '$1:***@',
    )
  }
}
