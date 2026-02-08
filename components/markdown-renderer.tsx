"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { withBasePath } from "@/lib/utils"

interface MarkdownRendererProps {
  content: string
  articleDirectory?: string
}

export function MarkdownRenderer({ content, articleDirectory }: MarkdownRendererProps) {
  return (
    <div className="prose prose-lg max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
        h1: ({ children }) => <h1 className="mb-6 mt-8 text-4xl font-bold text-balance">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-4 mt-8 text-3xl font-semibold text-balance">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-3 mt-6 text-2xl font-semibold">{children}</h3>,
        p: ({ children }) => <p className="mb-4 leading-relaxed text-pretty">{children}</p>,
        ul: ({ children }) => <ul className="mb-4 ml-6 list-disc space-y-2">{children}</ul>,
        ol: ({ children }) => <ol className="mb-4 ml-6 list-decimal space-y-2">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        a: ({ href, children }) => (
          <a
            href={href}
            className="text-primary underline decoration-primary/30 transition-colors hover:decoration-primary"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-4 border-l-4 border-primary pl-4 italic text-muted-foreground">
            {children}
          </blockquote>
        ),
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "")
          const isInline = !match

          if (isInline) {
            return (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm" {...props}>
                {children}
              </code>
            )
          }

          return (
            <SyntaxHighlighter
              style={oneDark as any}
              language={match[1]}
              PreTag="div"
              className="my-4 rounded-lg"
            >
              {String(children).replace(/\n$/, "")}
            </SyntaxHighlighter>
          )
        },
        img: ({ src, alt }) => {
          const srcString = typeof src === 'string' ? src : ''
          let imageSrc = srcString

          // If it's a relative path and we have an article directory, prepend the article path
          if (articleDirectory && srcString && !srcString.startsWith("http")) {
            imageSrc = `/data/${articleDirectory}/${srcString}`
          }

          // Add basePath to all non-external images
          if (imageSrc && !imageSrc.startsWith("http")) {
            imageSrc = withBasePath(imageSrc)
          }

          return <img src={imageSrc || withBasePath("/placeholder.svg")} alt={alt || ""} className="my-6 rounded-lg" />
        },
      }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
