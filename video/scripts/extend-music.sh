#!/bin/bash
# Alarga la música repitiendo compases enteros de la misma sección (120 BPM: compás = 2 s,
# rejilla desplazada 0,04 s). Mantiene la entrada fuerte con el sello, el respiro con la app
# de escritorio y el final. Genera public/audio/music-long.mp3 desde public/audio/music.mp3.
set -e
cd "$(dirname "$0")/.."
IN=public/audio/music.mp3
O=0.04
# tramos [inicio, fin) en segundos de la canción original, en orden
SEGS=(
  "0 $O+4"             # intro
  "$O+2 $O+4"          # + 1 compás de intro (el sello cae ahora a los 6 s)
  "$O+4 $O+22"         # parte fuerte
  "$O+8 $O+22"         # + 7 compases de parte fuerte
  "$O+22 $O+32"        # final de la parte fuerte
  "$O+32 $O+34"        # respiro (1.er compás repetido)
  "$O+32 $O+36"        # respiro
  "$O+36 $O+48"        # segunda parte fuerte
  "$O+40 $O+48"        # + 4 compases
  "$O+48 999"          # hasta el final
)
F=""; L=""
for i in "${!SEGS[@]}"; do
  read -r a b <<< "${SEGS[$i]}"
  a=$(echo "$a" | bc -l); b=$(echo "$b" | bc -l)
  # Fundidos de 6 ms en cada unión para que no haya clics; sin solaparse, así no se desplaza el ritmo
  F+="[0:a]atrim=start=$a:end=$b,asetpts=PTS-STARTPTS,afade=t=in:d=0.006,areverse,afade=t=in:d=0.006,areverse[s$i];"
  L+="[s$i]"
done
ffmpeg -v error -y -i "$IN" -filter_complex "${F}${L}concat=n=${#SEGS[@]}:v=0:a=1[out]" -map "[out]" -c:a libmp3lame -b:a 192k public/audio/music-long.mp3
ffprobe -v error -show_entries format=duration -of csv=p=0 public/audio/music-long.mp3
