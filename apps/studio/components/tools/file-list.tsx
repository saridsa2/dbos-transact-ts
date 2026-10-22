'use client';
import { useState } from 'react';
import { ControlButton } from '@/components/control/controls';
import { FileCode01, File02, BracketsEllipses, Folder, FolderClosed } from '@untitledui/icons';
import { ChevronDown, ChevronRight } from '@/components/fa-icons';

/** Shared folder hierarchy for both editable packages and read-only built-ins. */
export function ToolFileList({
  paths,
  selected,
  onSelect,
  prefix = '',
}: {
  paths: string[];
  selected: string;
  onSelect: (path: string) => void;
  prefix?: string;
}) {
  const depth = prefix.split('/').filter(Boolean).length;
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const names = [
    ...new Set(paths.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length).split('/')[0])),
  ];
  const folder = (name: string) => paths.some((path) => path.startsWith(`${prefix}${name}/`));
  names.sort((a, b) => Number(folder(b)) - Number(folder(a)) || a.localeCompare(b));
  return (
    <ul className="tool-file-tree">
      {names.map((name) => {
        const path = prefix + name;
        const FileIcon = name.endsWith('.json') ? BracketsEllipses : /\.(tsx?|jsx?)$/.test(name) ? FileCode01 : File02;
        if (!folder(name))
          return (
            <li key={path}>
              <ControlButton
                color="tertiary"
                className={selected === path ? 'tool-file selected' : 'tool-file'}
                style={{ paddingLeft: 8 + depth * 20 }}
                aria-label={`Open ${path}`}
                aria-current={selected === path ? 'page' : undefined}
                onPress={() => onSelect(path)}
              >
                <span className="tool-tree-disclosure" aria-hidden="true" />
                <FileIcon className="tool-tree-kind" aria-hidden="true" />
                <span className="tool-tree-label" title={path}>
                  {name}
                </span>
              </ControlButton>
            </li>
          );
        const open = !collapsed.includes(path);
        return (
          <li key={path}>
            <ControlButton
              color="tertiary"
              className="tool-file tool-folder-toggle"
              style={{ paddingLeft: 8 + depth * 20 }}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${path} folder`}
              aria-expanded={open}
              onPress={() => setCollapsed((value) => (open ? [...value, path] : value.filter((item) => item !== path)))}
            >
              <span className="tool-tree-disclosure" aria-hidden="true">
                {open ? <ChevronDown /> : <ChevronRight />}
              </span>
              {open ? (
                <Folder className="tool-tree-kind" aria-hidden="true" />
              ) : (
                <FolderClosed className="tool-tree-kind" aria-hidden="true" />
              )}
              <span className="tool-tree-label" title={path}>
                {name}
              </span>
            </ControlButton>
            {open && <ToolFileList paths={paths} selected={selected} onSelect={onSelect} prefix={path + '/'} />}
          </li>
        );
      })}
    </ul>
  );
}
