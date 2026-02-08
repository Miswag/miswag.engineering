import { notFound } from "next/navigation"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MarkdownRenderer } from "@/components/markdown-renderer"
import { getArticles, getCategories, getTeamMembers, getArticleContent } from "@/lib/data"
import { Badge } from "@/components/ui/badge"
import { Calendar, User, Tag } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import { withBasePath } from "@/lib/utils"
import { SITE_URL, SITE_NAME } from "@/lib/constants"
import type { Metadata } from "next"

interface ArticlePageProps {
  params: Promise<{
    id: string
  }>
}

export async function generateStaticParams() {
  const articles = await getArticles()
  return articles.map((article) => ({
    id: article.article_id,
  }))
}

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const resolvedParams = await params
  const [articles, categories, teamMembers] = await Promise.all([getArticles(), getCategories(), getTeamMembers()])

  const article = articles.find((a) => a.article_id === resolvedParams.id)

  if (!article) {
    return {
      title: "Article Not Found",
    }
  }

  const author = teamMembers.find((m) => m.team_id === article.author_team_id)
  const category = categories.find((c) => c.category_id === article.category_id)
  const articleUrl = `${SITE_URL}/articles/${article.article_id}/`
  const imageUrl = article.featured_image
    ? `${SITE_URL}/data/${article.article_directory}/${article.featured_image}`
    : `${SITE_URL}/logo.png`

  return {
    title: article.article_title,
    description: article.article_description,
    keywords: article.article_keywords,
    authors: author ? [{ name: author.team_member_name, url: author.team_member_linkedin }] : undefined,
    openGraph: {
      type: "article",
      locale: "en_US",
      url: articleUrl,
      siteName: SITE_NAME,
      title: article.article_title,
      description: article.article_description,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: article.article_title,
          type: article.featured_image?.endsWith(".png") ? "image/png" : "image/webp",
        },
      ],
      publishedTime: article.article_created_at,
      modifiedTime: article.article_created_at,
      authors: author ? [author.team_member_name] : undefined,
      tags: article.article_keywords,
      section: category?.category_name,
    },
    twitter: {
      card: "summary_large_image",
      title: article.article_title,
      description: article.article_description,
      images: [imageUrl],
      creator: author?.team_member_linkedin,
      site: "@miswag",
    },
    alternates: {
      canonical: articleUrl,
    },
  }
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const resolvedParams = await params
  const [articles, categories, teamMembers] = await Promise.all([getArticles(), getCategories(), getTeamMembers()])

  const article = articles.find((a) => a.article_id === resolvedParams.id)

  if (!article) {
    notFound()
  }

  const author = teamMembers.find((m) => m.team_id === article.author_team_id)
  const category = categories.find((c) => c.category_id === article.category_id)
  const content = await getArticleContent(article.article_directory)

  const articleUrl = `${SITE_URL}/articles/${article.article_id}/`
  const imageUrl = article.featured_image
    ? `${SITE_URL}/data/${article.article_directory}/${article.featured_image}`
    : `${SITE_URL}/logo.png`

  // JSON-LD structured data for Article
  const articleStructuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.article_title,
    description: article.article_description,
    image: imageUrl,
    datePublished: article.article_created_at,
    dateModified: article.article_created_at,
    author: author
      ? {
          "@type": "Person",
          name: author.team_member_name,
          url: author.team_member_linkedin,
        }
      : undefined,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/logo.png`,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": articleUrl,
    },
    keywords: article.article_keywords.join(", "),
    articleSection: category?.category_name,
  }

  // JSON-LD structured data for BreadcrumbList
  const breadcrumbStructuredData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Articles",
        item: `${SITE_URL}/articles/`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: article.article_title,
        item: articleUrl,
      },
    ],
  }

  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleStructuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbStructuredData) }}
      />
      <Header />

      <main className="flex-1">
        <article>
          {/* Article Header */}
          <section className="border-b border-border bg-muted/30 py-12">
            <div className="container mx-auto max-w-4xl px-4">
              <Link href="/articles">
                <Button variant="ghost" size="sm" className="mb-6 gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Articles
                </Button>
              </Link>

              {category && (
                <Badge variant="secondary" className="mb-4">
                  {category.category_name}
                </Badge>
              )}

              <h1 className="mb-6 text-4xl font-bold text-balance leading-tight md:text-5xl">
                {article.article_title}
              </h1>

              <p className="mb-6 text-lg text-muted-foreground text-pretty">{article.article_description}</p>

              <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
                {author && (
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    <span>By {author.team_member_name}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>
                    {new Date(article.article_created_at).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Featured Image */}
          {article.featured_image && (
            <section className="border-b border-border">
              <div className="container mx-auto max-w-4xl px-4 py-8">
                <div className="relative aspect-video w-full overflow-hidden rounded-lg">
                  <Image
                    src={withBasePath(`/data/${article.article_directory}/${article.featured_image}`)}
                    alt={article.article_title}
                    fill
                    className="object-cover"
                  />
                </div>
              </div>
            </section>
          )}

          {/* Article Content */}
          <section className="py-12">
            <div className="container mx-auto max-w-4xl px-4">
              <MarkdownRenderer content={content} articleDirectory={article.article_directory} />
            </div>
          </section>

          {/* Article Footer - Keywords and Author */}
          <section className="border-t border-border bg-muted/20 py-8">
            <div className="container mx-auto max-w-4xl px-4">
              {article.article_keywords.length > 0 && (
                <div className="mb-6">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <Tag className="h-4 w-4" />
                    <span>Keywords</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {article.article_keywords.map((keyword) => (
                      <Badge key={keyword} variant="outline">
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {author && (
                <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-6">
                  <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                    <Image
                      src={withBasePath(`/avatars/${author.team_member_avatar}`)}
                      alt={author.team_member_name}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Written by</p>
                    <p className="text-lg font-semibold">
                      {author.team_member_name}
                    </p>
                    <p className="text-sm text-muted-foreground">{author.team_member_position}</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </article>
      </main>

      <Footer />
    </div>
  )
}
