import fs from "fs/promises"
import path from "path"

export interface SiteConfig {
  title: string
  bio: string
}

export interface Category {
  category_id: number
  category_name: string
}

export interface TeamMember {
  team_id: number
  team_member_name: string
  team_member_position: string
  team_member_linkedin: string
  team_member_avatar: string
  team_member_bio?: string
}

export interface Article {
  article_id: string
  article_title: string
  author_team_id: number
  category_id: number
  article_created_at: string
  article_keywords: string[]
  article_description: string
  article_directory: string
  featured_image: string
}

export interface AboutValue {
  icon: string
  title: string
  description: string
}

export interface AboutContent {
  title: string
  subtitle: string
  mission: {
    heading: string
    description: string
  }
  values: AboutValue[]
  contact: {
    heading: string
    description: string
  }
}

export interface SocialLink {
  name: string
  url: string
}

export interface FooterContent {
  copyright: string
  socialLinks: SocialLink[]
}

const publicDir = path.join(process.cwd(), "public")

export async function getSiteConfig(): Promise<SiteConfig> {
  const filePath = path.join(publicDir, "content", "site.json")
  const fileContent = await fs.readFile(filePath, "utf-8")
  return JSON.parse(fileContent)
}

export async function getCategories(): Promise<Category[]> {
  const filePath = path.join(publicDir, "content", "categories.json")
  const fileContent = await fs.readFile(filePath, "utf-8")
  return JSON.parse(fileContent)
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  const filePath = path.join(publicDir, "content", "team.json")
  const fileContent = await fs.readFile(filePath, "utf-8")
  return JSON.parse(fileContent)
}

export async function getArticles(): Promise<Article[]> {
  const filePath = path.join(publicDir, "content", "articles.json")
  const fileContent = await fs.readFile(filePath, "utf-8")
  return JSON.parse(fileContent)
}

export async function getArticleContent(directory: string): Promise<string> {
  const filePath = path.join(publicDir, "data", directory, "index.md")
  const fileContent = await fs.readFile(filePath, "utf-8")
  return fileContent
}

export async function getAboutContent(): Promise<AboutContent> {
  const filePath = path.join(publicDir, "content", "about.json")
  const fileContent = await fs.readFile(filePath, "utf-8")
  return JSON.parse(fileContent)
}

export async function getFooterContent(): Promise<FooterContent> {
  const filePath = path.join(publicDir, "content", "footer.json")
  const fileContent = await fs.readFile(filePath, "utf-8")
  return JSON.parse(fileContent)
}
