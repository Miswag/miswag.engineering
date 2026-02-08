import Link from "next/link"
import Image from "next/image"
import { withBasePath } from "@/lib/utils"

export function Header() {
  return (
    <header className="border-b border-border bg-background">
      <div className="container mx-auto flex h-16 items-center justify-center px-4">
        <Link href="/" className="flex items-center space-x-2">
          <Image src={withBasePath("/logo.png")} alt="Miswag" width={150} height={40} className="h-10 w-auto" priority />
        </Link>
      </div>
    </header>
  )
}
