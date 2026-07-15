import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link as LinkIcon,
  Undo,
  Redo,
} from 'lucide-react';
import { cn } from './cn.js';

export interface RichTextEditorProps {
  /** HTML content — this component reads/writes editor.getHTML(). */
  value: string;
  onChange: (html: string) => void;
  label?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  wrapperClassName?: string;
}

function ToolbarButton({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'bg-primary-subtle text-brand'
          : 'text-secondary hover:bg-surface-raised hover:text-primary'
      )}
    >
      {children}
    </button>
  );
}

/** Toolbar rich text editor built on Tiptap (the standard, well-maintained choice — a
 * hand-rolled contenteditable editor is a poor use of from-scratch effort: undo/redo,
 * list handling, and paste sanitization are all easy to get subtly wrong). Wrapped in the
 * same border/radius/focus chrome as every other control in this family. */
export default function RichTextEditor({
  value,
  onChange,
  label,
  error,
  hint,
  disabled,
  required,
  placeholder = 'Write something…',
  wrapperClassName = '',
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          'prose-sm max-w-none min-h-[8rem] px-3.5 py-2.5 text-primary outline-none [&_p]:my-1 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_a]:text-link [&_a]:underline',
        'data-placeholder': placeholder,
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // Keep the editor in sync when `value` changes from outside (e.g. form reset/load) —
  // guarded by a content comparison so it doesn't fight the user's own typing (onUpdate
  // above already keeps `value` current for in-editor edits).
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  function setLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').url as string | undefined;
    const url = window.prompt('Link URL', previousUrl ?? '');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      {label && (
        <label className="text-sm font-medium text-primary tracking-[-0.01em]">
          {label}
          {required && (
            <span className="text-danger ml-0.5" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <div
        className={cn(
          'rounded-md border bg-surface-card transition-[border-color,box-shadow] duration-150 ease-out',
          disabled && 'cursor-not-allowed opacity-50 bg-surface-subtle',
          error
            ? 'border-error focus-within:shadow-[var(--shadow-focus-error)]'
            : 'border-default hover:border-strong focus-within:border-focus focus-within:shadow-[var(--shadow-focus)]'
        )}
      >
        <div className="flex items-center gap-0.5 border-b border-default px-2 py-1.5">
          <ToolbarButton
            label="Bold"
            active={editor?.isActive('bold')}
            disabled={disabled}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold size={15} />
          </ToolbarButton>
          <ToolbarButton
            label="Italic"
            active={editor?.isActive('italic')}
            disabled={disabled}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic size={15} />
          </ToolbarButton>
          <ToolbarButton
            label="Underline"
            active={editor?.isActive('underline')}
            disabled={disabled}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon size={15} />
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-border-default" />
          <ToolbarButton
            label="Bullet list"
            active={editor?.isActive('bulletList')}
            disabled={disabled}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List size={15} />
          </ToolbarButton>
          <ToolbarButton
            label="Numbered list"
            active={editor?.isActive('orderedList')}
            disabled={disabled}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={15} />
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-border-default" />
          <ToolbarButton
            label="Link"
            active={editor?.isActive('link')}
            disabled={disabled}
            onClick={setLink}
          >
            <LinkIcon size={15} />
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-border-default" />
          <ToolbarButton
            label="Undo"
            disabled={disabled}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo size={15} />
          </ToolbarButton>
          <ToolbarButton
            label="Redo"
            disabled={disabled}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo size={15} />
          </ToolbarButton>
        </div>

        <EditorContent editor={editor} />
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {!error && hint && <p className="text-xs text-secondary">{hint}</p>}
    </div>
  );
}
