import { useCallback, useEffect, useRef, useState } from 'react'

// Audio playback hook: tracks time/duration/play state and persists the
// playback position per book so it resumes where it stopped. Text navigation
// is manual, so there is no audio<->text sync here.
export function useAudio(bookId?: string) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => setCurrentTime(audio.currentTime)
    const onDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onDuration)
    audio.addEventListener('durationchange', onDuration)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    setIsPlaying(!audio.paused)
    onDuration()
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onDuration)
      audio.removeEventListener('durationchange', onDuration)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  }, [bookId])

  // Persist playback position per book so it resumes where it stopped.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !bookId) return
    const key = `epub-fr.progress.${bookId}`

    const restore = () => {
      const saved = Number(localStorage.getItem(key))
      if (saved > 1 && (!audio.duration || saved < audio.duration - 1)) {
        audio.currentTime = saved
      }
    }
    if (audio.readyState >= 1) restore()
    else audio.addEventListener('loadedmetadata', restore, { once: true })

    let lastSaved = 0
    const save = () => {
      if (audio.currentTime > 0) localStorage.setItem(key, String(audio.currentTime))
    }
    const onTime = () => {
      const now = Date.now()
      if (now - lastSaved > 4000) {
        lastSaved = now
        save()
      }
    }
    const onHidden = () => {
      if (document.hidden) save()
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('pause', save)
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      audio.removeEventListener('loadedmetadata', restore)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('pause', save)
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [bookId])

  const seekTo = useCallback((time: number) => {
    const audio = audioRef.current
    if (audio) audio.currentTime = Math.max(0, time)
  }, [])

  const skipBy = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    const max = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity
    audio.currentTime = Math.min(Math.max(audio.currentTime + seconds, 0), max)
  }, [])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }, [])

  return { audioRef, currentTime, duration, isPlaying, togglePlay, seekTo, skipBy }
}
