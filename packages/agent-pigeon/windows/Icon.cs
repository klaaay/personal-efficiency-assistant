using System;
using System.IO;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Collections.Generic;

// Vector source for the shared executable, window and notification-area icon.
class IconBuilder {
    static void Main(string[] args) {
        int[] sizes = {16,24,32,48,64,128,256};
        var images = new List<byte[]>();
        foreach(int size in sizes) {
            using(var bitmap = new Bitmap(size,size,PixelFormat.Format32bppArgb))
            using(var g = Graphics.FromImage(bitmap)) {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                g.ScaleTransform(size/128f,size/128f);
                using(var background=new GraphicsPath())
                using(var teal=new SolidBrush(Color.FromArgb(22,117,104))) {
                    background.AddArc(4,4,42,42,180,90); background.AddArc(82,4,42,42,270,90);
                    background.AddArc(82,82,42,42,0,90); background.AddArc(4,82,42,42,90,90); background.CloseFigure();
                    g.FillPath(teal,background);
                }
                // A white pigeon in flight: raised wing, round head, small beak and fanned tail.
                using(var bird=new GraphicsPath()) {
                    bird.StartFigure();
                    bird.AddBezier(24,76,34,79,41,78,46,71);
                    bird.AddBezier(46,71,38,60,34,43,36,25);
                    bird.AddBezier(36,25,53,33,67,44,73,56);
                    bird.AddBezier(73,56,78,53,79,44,86,43);
                    bird.AddBezier(86,43,95,41,101,47,101,54);
                    bird.AddLine(101,54,113,59); bird.AddLine(113,59,100,64);
                    bird.AddBezier(100,64,95,84,78,94,57,90);
                    bird.AddLine(57,90,35,101); bird.AddLine(35,101,37,89);
                    bird.AddLine(37,89,23,91); bird.AddLine(23,91,30,82); bird.CloseFigure();
                    g.FillPath(Brushes.White,bird);
                }
                using(var eye=new SolidBrush(Color.FromArgb(22,117,104))) g.FillEllipse(eye,89,51,4,4);
                using(var stream=new MemoryStream()) {
                    bitmap.Save(stream,ImageFormat.Png); images.Add(stream.ToArray());
                    if(size==256) bitmap.Save(Path.ChangeExtension(args[0],"png"),ImageFormat.Png);
                }
            }
        }
        using(var writer=new BinaryWriter(File.Create(args[0]))) {
            writer.Write((ushort)0); writer.Write((ushort)1); writer.Write((ushort)sizes.Length);
            int offset=6+16*sizes.Length;
            for(int i=0;i<sizes.Length;i++) {
                writer.Write((byte)(sizes[i]==256?0:sizes[i])); writer.Write((byte)(sizes[i]==256?0:sizes[i]));
                writer.Write((byte)0); writer.Write((byte)0); writer.Write((ushort)1); writer.Write((ushort)32);
                writer.Write(images[i].Length); writer.Write(offset); offset+=images[i].Length;
            }
            foreach(var bytes in images) writer.Write(bytes);
        }
    }
}
