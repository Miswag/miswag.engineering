import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { ArticleCard } from "@/components/article-card"
import { getArticles, getCategories, getTeamMembers, getSiteConfig } from "@/lib/data"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"

export default async function HomePage() {
  const [articles, categories, teamMembers, siteConfig] = await Promise.all([
    getArticles(),
    getCategories(),
    getTeamMembers(),
    getSiteConfig(),
  ])

  // Sort articles by date and get latest 9
  const latestArticles = articles
    .sort((a, b) => new Date(b.article_created_at).getTime() - new Date(a.article_created_at).getTime())
    .slice(0, 9)

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="border-b border-border bg-muted/30 py-20">
          <div className="container mx-auto px-4">
            <div className="mx-auto max-w-3xl text-center">
              <h1 className="mb-6 text-5xl font-bold text-balance leading-tight">{siteConfig.title}</h1>
              <p className="mb-8 text-lg text-muted-foreground text-pretty">{siteConfig.bio}</p>
            </div>
          </div>
        </section>

        {/* Latest Articles Section */}
        <section className="py-16">
          <div className="container mx-auto px-4">
            <div className="mb-10 flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold text-balance">Latest Articles</h2>
                <p className="mt-2 text-muted-foreground">Insights and updates from our team</p>
              </div>
              <Link href="/articles">
                <Button variant="ghost" className="gap-2">
                  View All
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {latestArticles.map((article) => {
                const author = teamMembers.find((m) => m.team_id === article.author_team_id)
                const category = categories.find((c) => c.category_id === article.category_id)
                return (
                  <ArticleCard
                    key={article.article_id}
                    article={article}
                    author={author || { team_member_name: "Unknown" }}
                    category={category || { category_name: "Uncategorized" }}
                  />
                )
              })}
            </div>
          </div>
        </section>

      </main>

      <Footer />
    </div>
  )
}
