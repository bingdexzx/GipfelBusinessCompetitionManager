@echo off
REM logsreader launcher. Pure ASCII only (cmd.exe on GBK codepage misreads UTF-8 comments as commands).
node "%~dp0logsreader.mjs" %*
