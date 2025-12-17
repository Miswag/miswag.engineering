import Link from "next/link"
import Image from "next/image"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface ArticleCardProps {
  article: {
    article_id: string
    article_title: string
    article_description: string
    article_created_at: string
    article_keywords: string[]
    featured_image: string
    article_directory: string
  }
  author: {
    team_member_name: string
  }
  category: {
    category_name: string
  }
}

// export function ArticleCard({ article, author, category }: ArticleCardProps) {
//   return (
//     <Link href={`/articles/${article.article_id}`}>
//       <Card className="group h-full overflow-hidden transition-all hover:shadow-lg">
//         <div className="relative h-48 w-full overflow-hidden bg-muted">
//           <Image
//             src={`/data/${article.article_directory}/${article.featured_image}`}
//             alt={article.article_title}
//             fill
//             className="object-cover transition-transform group-hover:scale-105"
//           />
//         </div>
//         <CardHeader>
//           <div className="flex items-center justify-between">
//             <Badge variant="secondary" className="mb-2">
//               {category.category_name}
//             </Badge>
//             <span className="text-xs text-muted-foreground">
//               {new Date(article.article_created_at).toLocaleDateString("en-US", {
//                 year: "numeric",
//                 month: "short",
//                 day: "numeric",
//               })}
//             </span>
//           </div>
//           <CardTitle className="text-balance leading-tight group-hover:text-primary">{article.article_title}</CardTitle>
//           <CardDescription className="text-pretty">{article.article_description}</CardDescription>
//         </CardHeader>
//         <CardContent>
//           <div className="flex items-center justify-between">
//             <span className="text-sm text-muted-foreground">By {author.team_member_name}</span>
//             <div className="flex flex-wrap gap-1">
//               {article.article_keywords.slice(0, 2).map((keyword) => (
//                 <Badge key={keyword} variant="outline" className="text-xs">
//                   {keyword}
//                 </Badge>
//               ))}
//             </div>
//           </div>
//         </CardContent>
//       </Card>
//     </Link>
//   )
// }
export function ArticleCard({ article, author, category }: ArticleCardProps) {
  return (
    <Link href={`/articles/${article.article_id}`}>
      <Card className="group h-full overflow-hidden transition-all hover:shadow-lg p-0">
        {/* Image */}
        <div className="relative h-48 w-full overflow-hidden">
          <Image
            src={`/data/${article.article_directory}/${article.featured_image}`}
            alt={article.article_title}
            fill
            className="object-cover transition-transform group-hover:scale-105"
          />
        </div>

        {/* Header */}
        <CardHeader className="pt-4">
          <div className="flex items-center justify-between">
            <Badge variant="secondary" className="mb-2">
              {category.category_name}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(article.article_created_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>

          <CardTitle className="text-balance leading-tight group-hover:text-primary">
            {article.article_title}
          </CardTitle>

          <CardDescription className="text-pretty">
            {article.article_description}
          </CardDescription>
        </CardHeader>

        {/* Footer */}
        <CardContent className="pb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              By {author.team_member_name}
            </span>
            <div className="flex flex-wrap gap-1">
              {article.article_keywords.slice(0, 2).map((keyword) => (
                <Badge key={keyword} variant="outline" className="text-xs">
                  {keyword}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
