import type { Metadata } from "next"
import { SITE_URL, SITE_NAME } from "@/lib/constants"

const articlesDescription =
  "Explore our collection of technical articles covering data engineering, software development, cloud architecture, machine learning, and product design."

export const metadata: Metadata = {
  title: "All Articles",
  description: articlesDescription,
  openGraph: {
    type: "website",
    locale: "en_US",
    url: `${SITE_URL}/articles/`,
    siteName: SITE_NAME,
    title: "All Articles",
    description: articlesDescription,
    images: [
      {
        url: `${SITE_URL}/logo.png`,
        width: 1000,
        height: 291,
        alt: SITE_NAME,
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "All Articles",
    description: articlesDescription,
    images: [`${SITE_URL}/logo.png`],
    site: "@miswag",
  },
  alternates: {
    canonical: `${SITE_URL}/articles/`,
  },
}

export default function ArticlesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
