import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.svg'],
            manifest: {
                name: '篮球罚球记分器',
                short_name: '罚球记分器',
                description: '离线可用的篮球罚球记分与可乐账本应用',
                theme_color: '#111827',
                background_color: '#f3f4f6',
                display: 'standalone',
                start_url: '/',
                icons: [
                    {
                        src: 'pwa-192.svg',
                        sizes: '192x192',
                        type: 'image/svg+xml',
                    },
                    {
                        src: 'pwa-512.svg',
                        sizes: '512x512',
                        type: 'image/svg+xml',
                    },
                ],
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,svg,png,json}'],
            },
        }),
    ],
});
