const isProduction = process.env.NODE_ENV === "production";

function buildContentSecurityPolicy() {
  const commonDirectives = {
    "base-uri": ["'self'"],
    "default-src": ["'self'"],
    "font-src": ["'self'", "data:"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "img-src": ["'self'", "data:", "blob:"],
    "media-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "worker-src": ["'self'", "blob:"],
  };

  const directives = isProduction
    ? {
        ...commonDirectives,
        "connect-src": ["'self'"],
        // A stricter production CSP needs per-request nonces or hashes. Until then,
        // keep the Next.js-compatible static baseline and tighten other directives.
        "script-src": ["'self'", "'unsafe-inline'"],
      }
    : {
        ...commonDirectives,
        "connect-src": ["'self'", "http:", "https:", "ws:", "wss:"],
        "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      };

  return Object.entries(directives)
    .map(([directive, values]) =>
      values.length > 0 ? `${directive} ${values.join(" ")}` : directive
    )
    .join("; ");
}

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy(),
  },
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "autoplay=()",
      "camera=()",
      "display-capture=()",
      "fullscreen=(self)",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "publickey-credentials-get=(self)",
      "screen-wake-lock=()",
      "serial=()",
      "usb=()",
      "web-share=()",
    ].join(", "),
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
