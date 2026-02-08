"use client"

import { useState, useEffect, useMemo } from "react"
import { Header } from "@/components/header"
import { FooterClient as Footer } from "@/components/footer-client"
import { ArticleCard } from "@/components/article-card"
import type { Article, Category, TeamMember } from "@/lib/data"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, SlidersHorizontal } from "lucide-react"
import { withBasePath } from "@/lib/utils"

export default function ArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [sortBy, setSortBy] = useState<string>("date-desc")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const [articlesRes, categoriesRes, teamRes] = await Promise.all([
          fetch(withBasePath("/content/articles.json")),
          fetch(withBasePath("/content/categories.json")),
          fetch(withBasePath("/content/team.json")),
        ])

        const [articlesData, categoriesData, teamData] = await Promise.all([
          articlesRes.json(),
          categoriesRes.json(),
          teamRes.json(),
        ])

        setArticles(articlesData)
        setCategories(categoriesData)
        setTeamMembers(teamData)
      } catch (error) {
        console.error("[v0] Failed to fetch data:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  const filteredAndSortedArticles = useMemo(() => {
    let filtered = articles

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (article) =>
          article.article_title.toLowerCase().includes(query) ||
          article.article_description.toLowerCase().includes(query) ||
          article.article_keywords.some((keyword) => keyword.toLowerCase().includes(query)),
      )
    }

    // Filter by category
    if (selectedCategory !== "all") {
      filtered = filtered.filter((article) => article.category_id === Number.parseInt(selectedCategory))
    }

    // Sort
    const sorted = [...filtered]
    switch (sortBy) {
      case "date-desc":
        sorted.sort((a, b) => new Date(b.article_created_at).getTime() - new Date(a.article_created_at).getTime())
        break
      case "date-asc":
        sorted.sort((a, b) => new Date(a.article_created_at).getTime() - new Date(b.article_created_at).getTime())
        break
      case "title-asc":
        sorted.sort((a, b) => a.article_title.localeCompare(b.article_title))
        break
      case "title-desc":
        sorted.sort((a, b) => b.article_title.localeCompare(a.article_title))
        break
    }

    return sorted
  }, [articles, searchQuery, selectedCategory, sortBy])

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p className="text-muted-foreground">Loading articles...</p>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {/* Page Header */}
        <section className="border-b border-border bg-muted/30 py-12">
          <div className="container mx-auto px-4">
            <h1 className="mb-4 text-4xl font-bold text-balance">All Articles</h1>
            <p className="text-lg text-muted-foreground">
              Explore our collection of {articles.length} technical articles
            </p>
          </div>
        </section>

        {/* Filters */}
        <section className="border-b border-border bg-background py-6">
          <div className="container mx-auto px-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative flex-1 lg:max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search articles..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Filter by:</span>
                </div>

                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category.category_id} value={category.category_id.toString()}>
                        {category.category_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date-desc">Newest First</SelectItem>
                    <SelectItem value="date-asc">Oldest First</SelectItem>
                    <SelectItem value="title-asc">Title (A-Z)</SelectItem>
                    <SelectItem value="title-desc">Title (Z-A)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Results count */}
            <div className="mt-4">
              <p className="text-sm text-muted-foreground">
                Showing {filteredAndSortedArticles.length} of {articles.length} articles
              </p>
            </div>
          </div>
        </section>

        {/* Articles Grid */}
        <section className="py-12">
          <div className="container mx-auto px-4">
            {filteredAndSortedArticles.length === 0 ? (
              <div className="py-20 text-center">
                <p className="text-lg text-muted-foreground">No articles found matching your criteria.</p>
                <Button
                  variant="outline"
                  className="mt-4 bg-transparent"
                  onClick={() => {
                    setSearchQuery("")
                    setSelectedCategory("all")
                  }}
                >
                  Clear Filters
                </Button>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {filteredAndSortedArticles.map((article) => {
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
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
