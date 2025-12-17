import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { getAboutContent } from "@/lib/data"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { BookOpen, Users, TrendingUp, Target } from "lucide-react"

// Icon mapping
const iconMap = {
  BookOpen,
  Users,
  TrendingUp,
  Target,
}

export default async function AboutPage() {
  const aboutContent = await getAboutContent()

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        {/* Page Header */}
        <section className="border-b border-border bg-muted/30 py-12">
          <div className="container mx-auto px-4">
            <h1 className="mb-4 text-4xl font-bold text-balance">{aboutContent.title}</h1>
            <p className="text-lg text-muted-foreground">{aboutContent.subtitle}</p>
          </div>
        </section>

        {/* Mission Section */}
        <section className="py-16">
          <div className="container mx-auto max-w-4xl px-4">
            <div className="mb-12 text-center">
              <h2 className="mb-4 text-3xl font-bold text-balance">{aboutContent.mission.heading}</h2>
              <p className="text-lg leading-relaxed text-muted-foreground text-pretty">
                {aboutContent.mission.description}
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {aboutContent.values.map((value, index) => {
                const IconComponent = iconMap[value.icon as keyof typeof iconMap] || BookOpen
                return (
                  <Card key={index}>
                    <CardHeader>
                      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                        <IconComponent className="h-6 w-6 text-primary" />
                      </div>
                      <CardTitle>{value.title}</CardTitle>
                      <CardDescription>{value.description}</CardDescription>
                    </CardHeader>
                  </Card>
                )
              })}
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section className="border-t border-border bg-muted/20 py-16">
          <div className="container mx-auto max-w-2xl px-4 text-center">
            <h2 className="mb-4 text-3xl font-bold text-balance">{aboutContent.contact.heading}</h2>
            <p className="mb-6 text-lg text-muted-foreground text-pretty">{aboutContent.contact.description}</p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
