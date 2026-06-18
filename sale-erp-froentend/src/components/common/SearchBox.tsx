import React from 'react';
import { Search } from 'lucide-react';
import { Input } from '../ui/Input';

interface SearchBoxProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}

export const SearchBox: React.FC<SearchBoxProps> = ({
  placeholder = 'Search...',
  value,
  onChange,
}) => {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-3 text-gray-400" size={18} />
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-10"
      />
    </div>
  );
};
