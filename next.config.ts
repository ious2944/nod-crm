import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Le formulaire Contact peut transporter une photo. La limite par défaut
      // des Server Actions est de 1 Mo, or `MAX_PHOTO_BYTES` en autorise 2 :
      // sans cette ligne, Next refusait l'envoi avant que la validation
      // applicative — celle qui sait dire pourquoi — n'ait la main.
      // La marge couvre l'encodage multipart et les autres champs.
      bodySizeLimit: "3mb",
    },
  },
};

export default nextConfig;
