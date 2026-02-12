import Image from "next/image"
import { getFooterContent } from "@/lib/data"
import { withBasePath } from "@/lib/utils"

export async function Footer() {
  const footerContent = await getFooterContent()

  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center justify-between space-y-4 md:flex-row md:space-y-0">
          <div className="flex items-center space-x-2">
            <Image src={withBasePath("/favicon.ico")} alt="Miswag" width={32} height={32} className="h-8 w-8" />
            <span className="text-sm text-muted-foreground">{footerContent.copyright}</span>
          </div>

          <div className="flex space-x-6">
            {footerContent.socialLinks.map((link, index) => (
              <a
                key={index}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground transition-colors hover:text-primary"
              >
                {link.name}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
