set -e
cd "$(dirname "$0")/.."
mkdir -p out
for pair in Promo:en PromoEs:es; do
  id=${pair%%:*}; l=${pair##*:}
  npx remotion render $id out/raw-$l.mp4 --codec=h264 --crf=18 --log=error
  ffmpeg -v error -y -i out/raw-$l.mp4 -c:v copy -af loudnorm=I=-14:TP=-1.5:LRA=11 -ar 48000 -c:a aac -b:a 256k -movflags +faststart out/cartero-promo-$l.mp4
  # Versión web para la hero: 1600x900, más ligera
  ffmpeg -v error -y -i out/cartero-promo-$l.mp4 -vf scale=1600:-2 -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart out/web-$l.mp4
  ffmpeg -v error -y -ss 5.2 -i out/cartero-promo-$l.mp4 -frames:v 1 -vf scale=1600:-2 -q:v 3 out/poster-$l.jpg
  rm out/raw-$l.mp4
  cp out/web-$l.mp4 ../apps/landing/public/video/cartero-$l.mp4
  cp out/poster-$l.jpg ../apps/landing/public/video/poster-$l.jpg
done
ls -la out/*.mp4 out/*.jpg
