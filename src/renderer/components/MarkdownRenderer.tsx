/**
 * @file MarkdownRenderer.tsx
 * @description A lightweight, custom React component for parsing and rendering Markdown and formatted text block contents.
 * Exports the `MarkdownRenderer` component, which parses text into text blocks and styled code snippets.
 * Internally handles code fences (producing `CodeBlockCard`s with clipboard copy operations), Markdown headings, 
 * list structures, and inline formatting (bold text, inline code tags, and secure external links).
 * Extensively used across the Chat and Agent console panels to clean and display structured logs, agent outputs, and step details.
 */

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import './MarkdownRenderer.css';

interface MarkdownRendererProps {
  content: string;
}

/**
 * Modularized lightweight Markdown & Code block renderer.
 * Handles fenced code blocks with Copy button, headings, lists, inline formatting, and links.
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  if (!content) return null;

  // Split content into code blocks and markdown text blocks
  const blocks = parseCodeBlocks(content);

  return (
    <div className="markdown-renderer">
      {blocks.map((block, idx) => {
        if (block.type === 'code') {
          return <CodeBlockCard key={idx} language={block.language} code={block.content} />;
        }
        return <TextBlock key={idx} text={block.content} />;
      })}
    </div>
  );
}

interface ParsedBlock {
  type: 'text' | 'code';
  language?: string;
  content: string;
}

function parseCodeBlocks(text: string): ParsedBlock[] {
  const codeBlockRegex = /```([\w-+]*)\n?([\s\S]*?)```/g;
  const blocks: ParsedBlock[] = [];
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      });
    }
    blocks.push({
      type: 'code',
      language: match[1] || 'code',
      content: match[2].trim(),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    blocks.push({
      type: 'text',
      content: text.slice(lastIndex),
    });
  }

  return blocks;
}

function CodeBlockCard({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="markdown-code-card">
      <div className="markdown-code-header">
        <span>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className={`markdown-code-copy ${copied ? 'is-copied' : ''}`}
          title="Copy code"
          aria-label={copied ? 'Code copied' : 'Copy code'}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="markdown-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function TextBlock({ text }: { text: string }) {
  const lines = text.split('\n');

  return (
    <div className="markdown-text-block">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="markdown-empty-line" />;

        // Headings
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={idx} className="markdown-heading markdown-heading-h4">
              {renderInlineFormatting(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={idx} className="markdown-heading markdown-heading-h3">
              {renderInlineFormatting(trimmed.slice(3))}
            </h3>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={idx} className="markdown-heading markdown-heading-h2">
              {renderInlineFormatting(trimmed.slice(2))}
            </h2>
          );
        }

        // Bullet lists (- or * or digit.)
        if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
          const listText = trimmed.replace(/^([-*]|\d+\.)\s+/, '');
          return (
            <div key={idx} className="markdown-list-item">
              <span className="markdown-list-marker">•</span>
              <span className="markdown-list-text">{renderInlineFormatting(listText)}</span>
            </div>
          );
        }

        return <div key={idx}>{renderInlineFormatting(line)}</div>;
      })}
    </div>
  );
}

/**
 * Parses inline formatting: **bold**, `inline code`, and [links](url)
 */
function renderInlineFormatting(line: string): React.ReactNode[] {
  const tokenRegex = /(\*\*.*?\*\*|`[^`]+`|\[.*?\]\(.*?\))/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={match.index} className="markdown-strong">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={match.index} className="markdown-inline-code">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[(.*?)\]\((.*?)\)/.exec(token);
      if (linkMatch) {
        parts.push(
          <a key={match.index} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="markdown-link">
            {linkMatch[1]}
          </a>
        );
      } else {
        parts.push(token);
      }
    } else {
      parts.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts;
}
