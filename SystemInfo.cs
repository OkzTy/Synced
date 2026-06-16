using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json.Serialization;
using Microsoft.Win32;

namespace ProjectBridge
{
    public static class SystemInfo
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private class MEMORYSTATUSEX
        {
            public uint dwLength;
            public uint dwMemoryLoad;
            public ulong ullTotalPhys;
            public ulong ullAvailPhys;
            public ulong ullTotalPageFile;
            public ulong ullAvailPageFile;
            public ulong ullTotalVirtual;
            public ulong ullAvailVirtual;
            public ulong ullAvailExtendedVirtual;
            public MEMORYSTATUSEX() { this.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX)); }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX lpBuffer);

        public static string GetCpuName()
        {
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0");
                if (key != null)
                {
                    var name = key.GetValue("ProcessorNameString") as string;
                    if (!string.IsNullOrEmpty(name))
                    {
                        return name.Trim();
                    }
                }
            }
            catch { }
            return "Unknown CPU";
        }

        public static string GetGpuName()
        {
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}");
                if (key != null)
                {
                    string fallbackGpu = null;
                    foreach (var subkeyName in key.GetSubKeyNames())
                    {
                        if (int.TryParse(subkeyName, out _))
                        {
                            using var subkey = key.OpenSubKey(subkeyName);
                            if (subkey != null)
                            {
                                var desc = subkey.GetValue("DriverDesc") as string;
                                if (!string.IsNullOrEmpty(desc) && !desc.Contains("Basic Render") && !desc.Contains("Basic Display"))
                                {
                                    string descLower = desc.ToLowerInvariant();
                                    if (!descLower.Contains("parsec") && 
                                        !descLower.Contains("virtual") && 
                                        !descLower.Contains("microsoft remote") && 
                                        !descLower.Contains("idd") && 
                                        !descLower.Contains("indirect"))
                                    {
                                        return desc;
                                    }
                                    if (fallbackGpu == null)
                                    {
                                        fallbackGpu = desc;
                                    }
                                }
                            }
                        }
                    }
                    if (fallbackGpu != null) return fallbackGpu;
                }
            }
            catch { }
            return "Unknown GPU";
        }

        public static string GetLocalIpAddress()
        {
            try
            {
                // Find active network interface's IP
                var activeInterface = NetworkInterface.GetAllNetworkInterfaces()
                    .Where(ni => ni.OperationalStatus == OperationalStatus.Up && 
                                 ni.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                    .OrderByDescending(ni => ni.GetIPProperties().GatewayAddresses.Count) // Prefer interfaces with gateways
                    .FirstOrDefault();

                if (activeInterface != null)
                {
                    var ip = activeInterface.GetIPProperties().UnicastAddresses
                        .FirstOrDefault(ua => ua.Address.AddressFamily == AddressFamily.InterNetwork);
                    if (ip != null)
                    {
                        return ip.Address.ToString();
                    }
                }

                // Fallback to DNS
                var host = Dns.GetHostEntry(Dns.GetHostName());
                foreach (var ip in host.AddressList)
                {
                    if (ip.AddressFamily == AddressFamily.InterNetwork)
                    {
                        return ip.ToString();
                    }
                }
            }
            catch { }
            return "127.0.0.1";
        }

        public static SystemStats GetStats()
        {
            var cpuName = GetCpuName();
            var gpuName = GetGpuName();
            var localIp = GetLocalIpAddress();

            // RAM Stats
            double ramTotalGB = 0;
            double ramUsedGB = 0;
            double ramFreeGB = 0;
            int ramUsagePercent = 0;

            var mem = new MEMORYSTATUSEX();
            if (GlobalMemoryStatusEx(mem))
            {
                ramTotalGB = Math.Round(mem.ullTotalPhys / (1024.0 * 1024.0 * 1024.0), 1);
                ramFreeGB = Math.Round(mem.ullAvailPhys / (1024.0 * 1024.0 * 1024.0), 1);
                ramUsedGB = Math.Round(ramTotalGB - ramFreeGB, 1);
                ramUsagePercent = (int)mem.dwMemoryLoad;
            }

            // Disk Stats
            var disks = DriveInfo.GetDrives()
                .Where(d => d.IsReady && (d.DriveType == DriveType.Fixed))
                .Select(d => new DiskStats
                {
                    Name = d.Name,
                    TotalGB = Math.Round(d.TotalSize / (1024.0 * 1024.0 * 1024.0), 1),
                    FreeGB = Math.Round(d.TotalFreeSpace / (1024.0 * 1024.0 * 1024.0), 1),
                    UsedGB = Math.Round((d.TotalSize - d.TotalFreeSpace) / (1024.0 * 1024.0 * 1024.0), 1),
                    UsagePercent = (int)Math.Round((double)(d.TotalSize - d.TotalFreeSpace) / d.TotalSize * 100)
                }).ToArray();

            // OS Info
            var osName = RuntimeInformation.OSDescription;

            // Running Processes (top memory consumers or relevant gaming/streaming processes)
            var relevantNames = new[] { "steam", "sunshine", "moonlight", "discord", "obs64", "cs2", "rust", "playit", "parsec", "projectbridge", "lmstudio", "llama" };
            var runningProcesses = Process.GetProcesses()
                .Select(p => {
                    try
                    {
                        return new ProcessInfo
                        {
                            Pid = p.Id,
                            Name = p.ProcessName,
                            MemoryMB = Math.Round(p.PrivateMemorySize64 / (1024.0 * 1024.0), 1)
                        };
                    }
                    catch { return null; }
                })
                .Where(p => p != null)
                .OrderByDescending(p => p!.MemoryMB)
                .Take(25) // Top 25 memory consumers
                .ToArray()!;

            return new SystemStats
            {
                Hostname = Environment.MachineName,
                IpAddress = localIp,
                OsName = osName,
                CpuName = cpuName,
                GpuName = gpuName,
                RamTotalGB = ramTotalGB,
                RamUsedGB = ramUsedGB,
                RamFreeGB = ramFreeGB,
                RamUsagePercent = ramUsagePercent,
                Disks = disks,
                Processes = runningProcesses
            };
        }
    }

    public class SystemStats
    {
        public string Hostname { get; set; } = "";
        public string IpAddress { get; set; } = "";
        public string OsName { get; set; } = "";
        public string CpuName { get; set; } = "";
        public string GpuName { get; set; } = "";
        public double RamTotalGB { get; set; }
        public double RamUsedGB { get; set; }
        public double RamFreeGB { get; set; }
        public int RamUsagePercent { get; set; }
        public DiskStats[] Disks { get; set; } = Array.Empty<DiskStats>();
        public ProcessInfo[] Processes { get; set; } = Array.Empty<ProcessInfo>();
    }

    public class DiskStats
    {
        public string Name { get; set; } = "";
        public double TotalGB { get; set; }
        public double UsedGB { get; set; }
        public double FreeGB { get; set; }
        public int UsagePercent { get; set; }
    }

    public class ProcessInfo
    {
        public int Pid { get; set; }
        public string Name { get; set; } = "";
        public double MemoryMB { get; set; }
    }
}
