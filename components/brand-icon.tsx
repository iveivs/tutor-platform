import Image from "next/image";

export function BrandIcon({ className = "size-12" }: { className?: string }) {
  return (
    <Image
      src="/app-icon-192.png"
      alt=""
      width={192}
      height={192}
      unoptimized
      className={`shrink-0 rounded-[22%] ${className}`}
    />
  );
}
