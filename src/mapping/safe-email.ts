import type { GeneratorFn } from './types.js'

const SAFE_DOMAINS = ['example.com', 'example.net', 'example.org']

/**
 * Creates a generator function that produces RFC 2606 safe emails.
 * Generated emails always use reserved domains:
 * example.com, example.net, example.org
 */
export function createSafeEmailGenerator(): GeneratorFn {
  return (faker) => {
    const email = faker.internet.email()
    const localPart = email.split('@')[0]
    const safeDomain = faker.helpers.arrayElement(SAFE_DOMAINS)
    return `${localPart}@${safeDomain}`
  }
}
