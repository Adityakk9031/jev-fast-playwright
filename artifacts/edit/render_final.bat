@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM  render_final.bat
REM  Renders final.mp4 from draft.mp4 by overlaying:
REM    - card_title.png  at t=0   (7s)
REM    - card_flow.png   at ~t=7  (8s)
REM    - card_result.png at ~t=15 (8s)
REM    - demo footage from draft.mp4
REM    - card_outro.png  at end   (7s)
REM  Plus: drawtext captions from artifacts/edit/c*.txt synced to mix.txt timings
REM ─────────────────────────────────────────────────────────────────────────────

set BASE=D:\jev_bridge\artifacts\edit
set FONT=C\:/Windows/Fonts/arialbd.ttf
set OUT=%BASE%\final.mp4

ffmpeg -y ^
  -loop 1 -t 7  -i "%BASE%\card_title.png"  ^
  -loop 1 -t 8  -i "%BASE%\card_flow.png"   ^
  -loop 1 -t 8  -i "%BASE%\card_result.png" ^
  -i            "%BASE%\draft.mp4"           ^
  -loop 1 -t 7  -i "%BASE%\card_outro.png"  ^
  -filter_complex "
[0:v]fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1[v_title];
[1:v]fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1[v_flow];
[2:v]fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1[v_result];
[3:v]fps=30,scale=1280:720,setsar=1,
drawtext=fontfile='%FONT%':textfile='%BASE%/c1.txt':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=660:enable='between(t,0.5,6.8)',
drawtext=fontfile='%FONT%':textfile='%BASE%/c3.txt':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=660:enable='between(t,15.5,21.5)',
drawtext=fontfile='%FONT%':textfile='%BASE%/c5a.txt':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=660:enable='between(t,31,44)',
drawtext=fontfile='%FONT%':textfile='%BASE%/c5b.txt':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=660:enable='between(t,44,48.8)',
drawtext=fontfile='%FONT%':textfile='%BASE%/c6.txt':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=660:enable='between(t,49.3,53.2)',
drawtext=fontfile='%FONT%':textfile='%BASE%/c7a.txt':fontcolor=0xffd479:fontsize=26:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=660:enable='between(t,54,59.5)',
drawtext=fontfile='%FONT%':textfile='%BASE%/c7b.txt':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=660:enable='between(t,59.5,68)',
drawtext=fontfile='%FONT%':textfile='%BASE%/c8.txt':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=660:enable='between(t,69.5,80)',
drawtext=fontfile='%FONT%':textfile='%BASE%/c9.txt':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=660:enable='between(t,82,88.3)',
drawtext=fontfile='%FONT%':textfile='%BASE%/c9b.txt':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=660:enable='between(t,89,96.5)',
drawtext=fontfile='%FONT%':textfile='%BASE%/c10.txt':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=660:enable='between(t,98,108)',
drawtext=fontfile='%FONT%':textfile='%BASE%/c10b.txt':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=660:enable='between(t,111,121)'[v_demo];
[4:v]fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1[v_outro];
[v_title][v_flow][v_result][v_demo][v_outro]concat=n=5:v=1:a=0[vout];
[3:a]apad,atrim=0:137.9[aout]
" ^
  -map "[vout]" -map "[aout]" ^
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p ^
  -c:a aac -b:a 192k ^
  "%OUT%"

echo.
echo Done! Output: %OUT%
