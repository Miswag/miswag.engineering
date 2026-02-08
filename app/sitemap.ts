import { MetadataRoute } from "next"
import { getArticles } from "@/lib/data"
import { SITE_URL } from "@/lib/constants"

export const dynamic = "force-static"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await getArticles()

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/articles/`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
  ]

  // Dynamic article pages
  const articlePages: MetadataRoute.Sitemap = articles.map((article) => ({
    url: `${SITE_URL}/articles/${article.article_id}/`,
    lastModified: new Date(article.article_created_at),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }))

  return [...staticPages, ...articlePages]
}
