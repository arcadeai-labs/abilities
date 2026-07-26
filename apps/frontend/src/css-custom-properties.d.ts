import "react"

/**
 * Lets `style` props set CSS custom properties (`--sidebar-width`, `--ratio`, …)
 * without a type assertion; React forwards them to the DOM as-is.
 */
declare module "react" {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined
  }
}
