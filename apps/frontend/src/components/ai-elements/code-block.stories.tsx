import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockLanguageSelector,
  CodeBlockLanguageSelectorContent,
  CodeBlockLanguageSelectorItem,
  CodeBlockLanguageSelectorTrigger,
  CodeBlockLanguageSelectorValue,
  CodeBlockTitle,
} from "./code-block"

const tsExample = `export function greet(name: string) {
  return \`Hello, \${name}!\`
}

console.log(greet("Tel Aviv"))
`

const jsonExample = `{
  "name": "return-types-test",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}
`

const meta = {
  title: "molecules/CodeBlock",
  component: CodeBlock,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => <CodeBlock code={tsExample} language="tsx" />,
}

export const WithLineNumbers: Story = {
  render: () => (
    <CodeBlock code={tsExample} language="tsx" showLineNumbers />
  ),
}

export const WithHeader: Story = {
  render: () => (
    <CodeBlock code={tsExample} language="tsx" showLineNumbers>
      <CodeBlockHeader>
        <CodeBlockTitle>
          <CodeBlockFilename>greet.tsx</CodeBlockFilename>
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton />
        </CodeBlockActions>
      </CodeBlockHeader>
    </CodeBlock>
  ),
}

export const Json: Story = {
  render: () => (
    <CodeBlock code={jsonExample} language="json">
      <CodeBlockHeader>
        <CodeBlockTitle>
          <CodeBlockFilename>package.json</CodeBlockFilename>
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton />
        </CodeBlockActions>
      </CodeBlockHeader>
    </CodeBlock>
  ),
}

export const WithLanguageSelector: Story = {
  render: function WithLanguageSelectorStory() {
    const [language, setLanguage] = useState<"tsx" | "json">("tsx")
    const code = language === "tsx" ? tsExample : jsonExample

    return (
      <CodeBlock code={code} language={language} showLineNumbers>
        <CodeBlockHeader>
          <CodeBlockTitle>
            <CodeBlockFilename>
              {language === "tsx" ? "greet.tsx" : "package.json"}
            </CodeBlockFilename>
          </CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockLanguageSelector
              onValueChange={(value) => setLanguage(value as "tsx" | "json")}
              value={language}
            >
              <CodeBlockLanguageSelectorTrigger>
                <CodeBlockLanguageSelectorValue />
              </CodeBlockLanguageSelectorTrigger>
              <CodeBlockLanguageSelectorContent>
                <CodeBlockLanguageSelectorItem value="tsx">
                  TSX
                </CodeBlockLanguageSelectorItem>
                <CodeBlockLanguageSelectorItem value="json">
                  JSON
                </CodeBlockLanguageSelectorItem>
              </CodeBlockLanguageSelectorContent>
            </CodeBlockLanguageSelector>
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
    )
  },
}
