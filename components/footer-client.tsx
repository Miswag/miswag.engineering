"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { withBasePath } from "@/lib/utils"

interface SocialLink {
  name: string
  url: string
}

interface FooterContent {
  copyright: string
  socialLinks: SocialLink[]
}

export function FooterClient() {
  const [footerContent, setFooterContent] = useState<FooterContent>({
    copyright: "© 2025 Miswag. All rights reserved.",
    socialLinks: [],
  })

  useEffect(() => {
    fetch(withBasePath("/content/footer.json"))
      .then((res) => res.json())
      .then((data) => setFooterContent(data))
      .catch((error) => console.error("Failed to load footer:", error))
  }, [])

  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center justify-between space-y-4 md:flex-row md:space-y-0">
          <div className="flex items-center space-x-2">
            <Image src={withBasePath("/favicon.png")} alt="Miswag" width={32} height={32} className="h-8 w-8" />
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
