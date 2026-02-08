import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Get the base path for the application
export function getBasePath() {
  return process.env.NEXT_PUBLIC_BASE_PATH || ""
}

// Add base path to public assets
export function withBasePath(path: string) {
  // Don't add basePath for external URLs
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("//")) {
    return path
  }

  const basePath = getBasePath()

  // No basePath configured, return normalized path
  if (!basePath) {
    return path.startsWith("/") ? path : `/${path}`
  }

  // If path already starts with basePath, return as is
  if (path.startsWith(basePath)) {
    return path
  }

  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`

  return `${basePath}${normalizedPath}`
}
