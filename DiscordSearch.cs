using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ProjectBridge
{
    public static class DiscordSearch
    {
        private static List<DiscordThread> _threads = new();

        public static void Initialize(string? customFilePath = null)
        {
            try
            {
                string jsonContent = "";

                // 1. Try custom local file path first (useful for edits)
                string localPath = customFilePath ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "discord_archive.json");
                if (File.Exists(localPath))
                {
                    jsonContent = File.ReadAllText(localPath);
                }
                else
                {
                    // 2. Fall back to embedded resource
                    var assembly = Assembly.GetExecutingAssembly();
                    // Embedded resource names usually follow: AssemblyName.Folder.Filename
                    // Let's search manifest resource names to find it
                    string resourceName = assembly.GetManifestResourceNames()
                        .FirstOrDefault(n => n.EndsWith("discord_archive.json")) ?? "";

                    if (!string.IsNullOrEmpty(resourceName))
                    {
                        using var stream = assembly.GetManifestResourceStream(resourceName);
                        if (stream != null)
                        {
                            using var reader = new StreamReader(stream);
                            jsonContent = reader.ReadToEnd();
                        }
                    }
                }

                if (!string.IsNullOrEmpty(jsonContent))
                {
                    var options = new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    };
                    _threads = JsonSerializer.Deserialize<List<DiscordThread>>(jsonContent, options) ?? new();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[WARNING] Failed to load Discord archive: {ex.Message}");
                _threads = new();
            }
        }

        public static List<DiscordThread> Search(string query)
        {
            if (string.IsNullOrWhiteSpace(query))
            {
                return _threads;
            }

            var keywords = query.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(k => k.Trim().ToLower())
                .ToList();

            var matches = new List<(DiscordThread Thread, int Score)>();

            foreach (var thread in _threads)
            {
                int score = 0;

                // Match thread title (high weight)
                foreach (var kw in keywords)
                {
                    if (thread.Title.ToLower().Contains(kw))
                    {
                        score += 10;
                    }
                }

                // Match tags (medium weight)
                foreach (var kw in keywords)
                {
                    if (thread.Tags.Any(t => t.ToLower() == kw))
                    {
                        score += 5;
                    }
                    else if (thread.Tags.Any(t => t.ToLower().Contains(kw)))
                    {
                        score += 2;
                    }
                }

                // Match messages content (low weight)
                foreach (var msg in thread.Messages)
                {
                    foreach (var kw in keywords)
                    {
                        if (msg.Content.ToLower().Contains(kw))
                        {
                            score += 1;
                        }
                    }
                }

                if (score > 0)
                {
                    matches.Add((thread, score));
                }
            }

            return matches.OrderByDescending(m => m.Score)
                .Select(m => m.Thread)
                .ToList();
        }

        public static List<DiscordThread> GetAll()
        {
            return _threads;
        }
    }

    public class DiscordThread
    {
        public int Id { get; set; }
        public string Title { get; set; } = "";
        public List<string> Tags { get; set; } = new();
        public List<DiscordMessage> Messages { get; set; } = new();
    }

    public class DiscordMessage
    {
        public string Author { get; set; } = "";
        public string Avatar { get; set; } = "blue"; // blue, green, purple, orange, red
        public string Timestamp { get; set; } = "";
        public string Content { get; set; } = "";
    }
}
